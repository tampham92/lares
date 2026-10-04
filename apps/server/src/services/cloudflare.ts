import net from 'node:net';
import path from 'node:path';
import type { CloudflareRealIpView } from '@lares/shared';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db/index.js';
import { t } from '../i18n/index.js';
import { errorMessage } from '../lib/errors.js';
import type { HostLogger } from './host.js';
import { testAndReload } from './nginx.js';
import { writeNginxConf } from './nginxConf.js';

/**
 * Real visitor IP for sites proxied by Cloudflare.
 *
 * nginx's realip module replaces $remote_addr with CF-Connecting-IP, but only for connections
 * coming from Cloudflare's published ranges, so nobody else can spoof the header. It lives in its
 * own http{}-level file next to the global conf rather than inside GLOBAL_CONF: the list is data
 * fetched at runtime with its own refresh/rollback cycle, a rejected list must never take the log
 * format or websocket map down with it, and disabling the feature is just deleting the file.
 */
export const cloudflareConfPath = () => path.join(path.dirname(config.nginxGlobalConf), 'lares-cloudflare.conf');

/** Bundled copy of https://www.cloudflare.com/ips-v4 and ips-v6, used until the first successful download. */
export const CLOUDFLARE_IPV4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];
export const CLOUDFLARE_IPV6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];

const SOURCES = { 4: 'https://www.cloudflare.com/ips-v4', 6: 'https://www.cloudflare.com/ips-v6' } as const;
const MAX_RANGES = 200;
const REFRESH_MS = 24 * 3_600_000;

/** `a.b.c.d/nn` or `x::y/nnn` (a bare address is accepted too) of the given family. */
export function isCidr(value: string, family: 4 | 6): boolean {
  const m = /^([0-9a-fA-F:.]+)(?:\/(\d{1,3}))?$/.exec(value);
  if (!m || net.isIP(m[1]!) !== family) return false;
  return m[2] === undefined || Number(m[2]) <= (family === 4 ? 32 : 128);
}

/**
 * Parse one of Cloudflare's plain-text lists. All or nothing: a single bad line (an HTML error
 * page, a captive portal, a truncated body) rejects the whole list, since it goes into nginx config.
 */
export function parseRangeList(text: string, family: 4 | 6): string[] {
  const lines = [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))];
  const bad = lines.find((l) => !isCidr(l, family));
  if (bad !== undefined) throw new Error(t('Danh sách IP Cloudflare có dòng không hợp lệ: {line}', { line: bad.slice(0, 80) }));
  if (!lines.length || lines.length > MAX_RANGES) throw new Error(t('Danh sách IP Cloudflare có số dòng bất thường ({n})', { n: lines.length }));
  return lines;
}

export function renderCloudflareConf(ipv4: string[], ipv6: string[]): string {
  // Re-validate: whatever ends up in the database, only well-formed ranges reach nginx.
  const v4 = ipv4.filter((r) => isCidr(r, 4));
  const v6 = ipv6.filter((r) => isCidr(r, 6));
  return [
    '# Managed by Lares - real visitor IP behind Cloudflare (changes will be overwritten)',
    '# Source: https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6',
    ...v4.map((r) => `set_real_ip_from ${r};`),
    ...v6.map((r) => `set_real_ip_from ${r};`),
    'real_ip_header CF-Connecting-IP;',
    '',
  ].join('\n');
}

type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export async function fetchCloudflareRanges(fetcher: Fetcher = fetch, timeoutMs = 10_000): Promise<{ ipv4: string[]; ipv6: string[] }> {
  const get = async (family: 4 | 6) => {
    const res = await fetcher(SOURCES[family], { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(t('Không tải được {url} (HTTP {status})', { url: SOURCES[family], status: res.status }));
    const body = await res.text();
    if (body.length > 64_000) throw new Error(t('Danh sách IP Cloudflare có số dòng bất thường ({n})', { n: body.split('\n').length }));
    return parseRangeList(body, family);
  };
  const [ipv4, ipv6] = await Promise.all([get(4), get(6)]);
  return { ipv4, ipv6 };
}

// ---- State ------------------------------------------------------------------

interface CloudflareState {
  enabled: boolean;
  ipv4: string[];
  ipv6: string[];
  fetchedAt: string | null;
  checkedAt: string | null;
  lastError: string | null;
}

const SETTING = 'cloudflareRealIp';

function getState(): CloudflareState {
  const s = getSetting<Partial<CloudflareState>>(SETTING, {});
  return {
    enabled: s.enabled ?? true,
    ipv4: s.ipv4?.length ? s.ipv4 : CLOUDFLARE_IPV4,
    ipv6: s.ipv6?.length ? s.ipv6 : CLOUDFLARE_IPV6,
    fetchedAt: s.fetchedAt ?? null,
    checkedAt: s.checkedAt ?? null,
    lastError: s.lastError ?? null,
  };
}

const saveState = (patch: Partial<CloudflareState>) => setSetting(SETTING, { ...getState(), ...patch });

export function getCloudflareView(): CloudflareRealIpView {
  return { ...getState(), confPath: cloudflareConfPath() };
}

/** Bring the conf file in line with the saved state (rewrites only when it differs). */
export async function applyCloudflareConf(log?: HostLogger): Promise<boolean> {
  const s = getState();
  const content = s.enabled ? renderCloudflareConf(s.ipv4, s.ipv6) : null;
  try {
    const changed = await writeNginxConf(cloudflareConfPath(), content, () => testAndReload(log));
    if (changed) log?.(s.enabled ? t('Đã cập nhật danh sách IP Cloudflare cho nginx ({n} dải)', { n: s.ipv4.length + s.ipv6.length }) : t('Đã tắt khôi phục IP thật sau Cloudflare'));
    if (s.lastError) saveState({ lastError: null });
    return changed;
  } catch (err) {
    saveState({ lastError: errorMessage(err) });
    throw err;
  }
}

export async function setCloudflareEnabled(enabled: boolean, log?: HostLogger): Promise<CloudflareRealIpView> {
  const before = getState().enabled;
  saveState({ enabled });
  try {
    await applyCloudflareConf(log);
  } catch (err) {
    saveState({ enabled: before });
    throw err;
  }
  return getCloudflareView();
}

/** Download the current lists; on any error keep the previous list (and config) untouched. */
export async function refreshCloudflareRanges(log?: HostLogger, fetcher?: Fetcher): Promise<CloudflareRealIpView> {
  const checkedAt = new Date().toISOString();
  let ranges: { ipv4: string[]; ipv6: string[] };
  try {
    ranges = await fetchCloudflareRanges(fetcher);
  } catch (err) {
    const error = err instanceof Error && err.name === 'TimeoutError' ? t('Hết thời gian chờ khi tải danh sách IP Cloudflare') : errorMessage(err);
    saveState({ checkedAt, lastError: error });
    throw new Error(error);
  }
  saveState({ ...ranges, fetchedAt: checkedAt, checkedAt, lastError: null });
  await applyCloudflareConf(log);
  return getCloudflareView();
}

/** Startup: write the conf from the saved/bundled list right away, refresh from cloudflare.com daily. */
export function startCloudflareRealIp(log: HostLogger) {
  const refresh = () => {
    if (!getState().enabled) return;
    refreshCloudflareRanges(log).catch((err) => log(t('Không cập nhật được danh sách IP Cloudflare: {error}', { error: errorMessage(err) })));
  };
  void applyCloudflareConf(log)
    .catch((err) => log(t('Không áp dụng được cấu hình IP Cloudflare: {error}', { error: errorMessage(err) })))
    .finally(() => {
      // first download shortly after startup, or when the last one is a day old
      const last = Date.parse(getState().fetchedAt ?? '') || 0;
      setTimeout(() => {
        refresh();
        setInterval(refresh, REFRESH_MS).unref();
      }, Math.max(30_000, last + REFRESH_MS - Date.now())).unref();
    });
}
