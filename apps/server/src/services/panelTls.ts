import fs from 'node:fs/promises';
import path from 'node:path';
import tls from 'node:tls';
import type { PanelDomainInput, PanelDomainView } from '@lares/shared';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db/index.js';
import { t } from '../i18n/index.js';
import { conflict, errorMessage } from '../lib/errors.js';
import { shq } from '../lib/shell.js';
import { host, type HostLogger } from './host.js';
import { acmeLocation, nginxRunning, testAndReload } from './nginx.js';
import { writeNginxConf } from './nginxConf.js';
import { findSiteByHostname } from './sites.js';
import { dnsWarnings, readCertInfo } from './ssl.js';

/**
 * Trusted certificate for the panel itself (https://<domain>:<port>).
 *
 * A small port-80 server block serves the shared ACME webroot for the panel hostname, certbot
 * issues a lineage with a fixed name (so changing the domain later reuses it and a failed
 * issuance leaves the old files in place), and LARES_TLS_CERT/KEY in the env file are pointed at
 * it. The running server swaps its TLS context in place; renewals reach it through SIGHUP.
 */
export const PANEL_CERT_NAME = 'lares-panel';
const LIVE_DIR = `/etc/letsencrypt/live/${PANEL_CERT_NAME}`;
export const PANEL_LE_FILES = { cert: `${LIVE_DIR}/fullchain.pem`, key: `${LIVE_DIR}/privkey.pem` };
/** certbot runs this after every issuance/renewal: SIGHUP makes the panel re-read its certificate. */
export const PANEL_DEPLOY_HOOK = 'systemctl kill --kill-who=main --signal=HUP lares';

export const envFilePath = () => process.env.LARES_ENV_FILE || (config.dryRun ? path.join(config.dataDir, 'lares.env') : '/etc/lares/lares.env');
export const panelVhostPath = () => path.join(path.dirname(config.nginxGlobalConf), 'lares-panel.conf');
export const panelUrl = (domain: string, port = config.port) => `https://${domain}${port === 443 ? '' : `:${port}`}`;

type CertPair = { cert: string; key: string };

/** Set KEY=value lines in an env file, keeping every other line (and comment) as it was. */
export function upsertEnv(content: string, values: Record<string, string>): string {
  const lines = content ? content.replace(/\n$/, '').split('\n') : [];
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /[\0\r\n]/.test(value)) throw new Error(`invalid env entry ${key}`);
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.startsWith(`${key}=`)) {
        lines[i] = `${key}=${value}`;
        found = true;
      }
    }
    if (!found) lines.push(`${key}=${value}`);
  }
  return lines.join('\n') + '\n';
}

export function renderPanelVhost(domain: string, port: number): string {
  const indent = (s: string) => s.replace(/^(?=.)/gm, '    ');
  return `# Managed by Lares - panel domain (ACME challenges + redirect to the panel)
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

${indent(acmeLocation())}

    location / {
        return 301 ${panelUrl(domain, port)}$request_uri;
    }
}
`;
}

// ---- Live TLS context ---------------------------------------------------------

let tlsServer: tls.Server | null = null;
let active: CertPair = { cert: config.tlsCert, key: config.tlsKey };

async function loadPair(pair: CertPair) {
  const [cert, key] = await Promise.all([fs.readFile(pair.cert), fs.readFile(pair.key)]);
  tls.createSecureContext({ cert, key }); // throws when the files are unusable or do not match
  return { cert, key };
}

/** Re-read the active certificate files into the running HTTPS server. False = not serving HTTPS. */
export async function reloadPanelTls(): Promise<boolean> {
  if (!tlsServer || !active.cert || !active.key) return false;
  tlsServer.setSecureContext(await loadPair(active));
  return true;
}

/** Called once at startup with the Fastify server; certbot's deploy hook sends SIGHUP after renewals. */
export function attachPanelServer(server: unknown, log: HostLogger) {
  if (server instanceof tls.Server) tlsServer = server;
  process.on('SIGHUP', () => {
    reloadPanelTls()
      .then((ok) => ok && log(t('Đã nạp lại chứng chỉ HTTPS của trang quản trị')))
      .catch((err) => log(t('Không nạp lại được chứng chỉ HTTPS của trang quản trị: {error}', { error: errorMessage(err) })));
  });
}

function scheduleRestart(log: HostLogger) {
  log(t('Trang quản trị sẽ khởi động lại sau vài giây để dùng chứng chỉ mới'));
  // after the HTTP response (and task log) had a chance to reach the browser
  setTimeout(() => void host.mutate('systemctl --no-block restart lares', { log }).catch(() => {}), 3000);
}

async function writeEnv(values: Record<string, string>) {
  const file = envFilePath();
  const current = await fs.readFile(file, 'utf8').catch(() => null);
  if (current === null && !config.dryRun) throw new Error(t('Không tìm thấy file cấu hình {path}', { path: file }));
  await host.writeFile(file, upsertEnv(current ?? '', values), 0o600);
}

/** Point the panel at another certificate: validate, persist in the env file, then apply. */
async function switchPanelTls(pair: CertPair, log: HostLogger) {
  const loaded = config.dryRun ? null : await loadPair(pair);
  await writeEnv({ LARES_TLS_CERT: pair.cert, LARES_TLS_KEY: pair.key });
  active = pair;
  if (!loaded) {
    log(`[dry-run] ${t('trang quản trị sẽ dùng chứng chỉ {path}', { path: pair.cert })}`);
  } else if (tlsServer) {
    tlsServer.setSecureContext(loaded);
    log(t('Đã áp dụng chứng chỉ mới cho trang quản trị (không cần khởi động lại)'));
  } else {
    scheduleRestart(log);
  }
}

// ---- Domain ---------------------------------------------------------------------

interface PanelDomainState {
  domain: string | null;
  email: string | null;
  /** The certificate used before switching to Let's Encrypt (install.sh's self-signed pair). */
  selfSigned: CertPair | null;
}

const SETTING = 'panelDomain';
const getState = (): PanelDomainState => ({ domain: null, email: null, selfSigned: null, ...getSetting<Partial<PanelDomainState>>(SETTING, {}) });

let busy = false;
export const panelDomainBusy = () => busy;

export async function getPanelDomainView(): Promise<PanelDomainView> {
  const s = getState();
  const info = active.cert ? await readCertInfo(active.cert) : null;
  return {
    domain: s.domain,
    email: s.email,
    url: s.domain ? panelUrl(s.domain) : null,
    port: config.port,
    https: tlsServer !== null,
    certFile: active.cert || null,
    issuer: info?.issuer ?? null,
    expiresAt: info?.expiresAt ?? null,
  };
}

export async function checkPanelDomain(domain: string): Promise<{ warnings: string[] }> {
  const owner = findSiteByHostname(domain);
  if (owner) return { warnings: [t('{name} đang được dùng bởi site {domain}', { name: domain, domain: owner.domain })] };
  return { warnings: await dnsWarnings([domain]) };
}

export async function setPanelDomain(input: PanelDomainInput, log: HostLogger): Promise<{ url: string }> {
  if (busy) throw conflict(t('Đang có thao tác khác với tên miền trang quản trị, hãy chờ hoàn tất'));
  busy = true;
  try {
    const { domain } = input;
    const owner = findSiteByHostname(domain);
    if (owner) throw conflict(t('{name} đang được dùng bởi site {domain}', { name: domain, domain: owner.domain }));

    log(t('Kiểm tra DNS của {domain}…', { domain }));
    const warnings = await dnsWarnings([domain]);
    if (warnings.length && !input.ignoreDns && !config.dryRun) {
      throw new Error(
        t('Tên miền chưa trỏ về máy chủ này: {details}. Trỏ bản ghi DNS A về IP máy chủ (nếu dùng Cloudflare: tắt proxy - đám mây xám) rồi thử lại.', {
          details: warnings.join('; '),
        }),
      );
    }
    for (const w of warnings) log(t('Cảnh báo DNS: {warning}', { warning: w }));
    if (!config.dryRun && !(await host.has('certbot'))) throw new Error(t('Chưa cài certbot (apt install certbot)'));
    if (!(await nginxRunning())) throw new Error(t('Let\'s Encrypt cần xác thực qua port 80: dừng web server cũ rồi chạy "systemctl enable --now nginx" trước khi cài SSL.'));

    // port 80: ACME challenges for the panel hostname, everything else to the panel
    const vhost = panelVhostPath();
    const previousVhost = await fs.readFile(vhost, 'utf8').catch(() => null);
    log(t('Ghi cấu hình nginx {path}', { path: vhost }));
    await writeNginxConf(vhost, renderPanelVhost(domain, config.port), () => testAndReload(log));

    log(t('Xin chứng chỉ Let\'s Encrypt cho {domain}…', { domain }));
    const certbot = [
      'certbot certonly --webroot',
      `-w ${shq(config.acmeDir)}`,
      `--cert-name ${shq(PANEL_CERT_NAME)}`,
      `-d ${shq(domain)}`,
      '--non-interactive --agree-tos --keep-until-expiring',
      input.email ? `-m ${shq(input.email)}` : '--register-unsafely-without-email',
      `--deploy-hook ${shq(PANEL_DEPLOY_HOOK)}`,
    ].join(' ');
    try {
      await host.mutate(certbot, { log, timeoutMs: 5 * 60_000 });
      if (!config.dryRun) {
        const info = await readCertInfo(PANEL_LE_FILES.cert);
        if (!info.domains.includes(domain)) throw new Error(t('Chứng chỉ nhận được không chứa {domain}', { domain }));
      }
    } catch (err) {
      await writeNginxConf(vhost, previousVhost, () => testAndReload(log)).catch(() => {});
      throw new Error(t('Không lấy được chứng chỉ Let\'s Encrypt cho {domain}: {error}', { domain, error: errorMessage(err) }));
    }

    const state = getState();
    // remember the self-signed pair the first time we move away from it, for "back to self-signed"
    const selfSigned = state.selfSigned ?? (active.cert && active.cert !== PANEL_LE_FILES.cert ? { ...active } : null);
    try {
      await switchPanelTls(PANEL_LE_FILES, log);
    } catch (err) {
      throw new Error(t('Chứng chỉ mới không dùng được, trang quản trị giữ chứng chỉ cũ: {error}', { error: errorMessage(err) }));
    }
    setSetting(SETTING, { domain, email: input.email ?? null, selfSigned } satisfies PanelDomainState);
    const url = panelUrl(domain);
    log(t('Xong. Trang quản trị: {url}', { url }));
    return { url };
  } finally {
    busy = false;
  }
}

/** Back to the self-signed certificate (regenerated if install.sh's pair is gone). */
export async function removePanelDomain(log: HostLogger): Promise<PanelDomainView> {
  if (busy) throw conflict(t('Đang có thao tác khác với tên miền trang quản trị, hãy chờ hoàn tất'));
  busy = true;
  try {
    const state = getState();
    const dir = path.dirname(envFilePath());
    const pair = state.selfSigned ?? { cert: path.join(dir, 'panel.crt'), key: path.join(dir, 'panel.key') };
    if (!config.dryRun && !((await host.exists(pair.cert)) && (await host.exists(pair.key)))) {
      log(t('Tạo lại chứng chỉ tự ký {path}', { path: pair.cert }));
      await host.mutate(
        `openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=Lares -keyout ${shq(pair.key)} -out ${shq(pair.cert)} && chmod 600 ${shq(pair.key)}`,
        { log },
      );
    }
    await switchPanelTls(pair, log);
    setSetting(SETTING, { domain: null, email: state.email, selfSigned: pair } satisfies PanelDomainState);

    // the panel already runs on the self-signed pair: clean-up failures are only reported
    await writeNginxConf(panelVhostPath(), null, () => testAndReload(log)).catch((err) =>
      log(t('Không gỡ được cấu hình nginx của tên miền trang quản trị: {error}', { error: errorMessage(err) })),
    );
    await host.mutate(`certbot delete --cert-name ${shq(PANEL_CERT_NAME)} --non-interactive 2>/dev/null || true`, { log });
    return await getPanelDomainView();
  } finally {
    busy = false;
  }
}
