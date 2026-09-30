import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import os from 'node:os';
import type { SslState } from '@tpanel/shared';
import { config } from '../config.js';
import { shq } from '../lib/shell.js';
import { host, type HostLogger } from './host.js';

export const EMPTY_SSL: SslState = { enabled: false, type: null, domains: [], issuer: null, expiresAt: null, forceHttps: false };

export function certPaths(domain: string, type: 'letsencrypt' | 'custom') {
  if (type === 'letsencrypt') {
    const dir = `/etc/letsencrypt/live/${domain}`;
    return { certificate: `${dir}/fullchain.pem`, privateKey: `${dir}/privkey.pem` };
  }
  const dir = path.join(config.sslDir, domain);
  return { certificate: path.join(dir, 'fullchain.pem'), privateKey: path.join(dir, 'privkey.pem') };
}

export async function readCertInfo(certFile: string): Promise<{ expiresAt: string | null; issuer: string | null; domains: string[] }> {
  const r = await host.exec(`openssl x509 -noout -enddate -issuer -ext subjectAltName -in ${shq(certFile)} 2>/dev/null`);
  if (r.code !== 0) return { expiresAt: null, issuer: null, domains: [] };
  const end = r.stdout.match(/notAfter=(.+)/)?.[1];
  const issuer = r.stdout.match(/issuer=.*?(?:O\s*=\s*([^,\n]+)|CN\s*=\s*([^,\n]+))/);
  const domains = [...r.stdout.matchAll(/DNS:([^,\s]+)/g)].map((m) => m[1]!);
  return {
    expiresAt: end ? new Date(end).toISOString() : null,
    issuer: issuer ? (issuer[1] ?? issuer[2] ?? '').trim() : null,
    domains,
  };
}

/** Warn early when DNS does not point here - otherwise Let's Encrypt fails with an opaque error. */
export async function dnsWarnings(domains: string[]): Promise<string[]> {
  const local = new Set(Object.values(os.networkInterfaces()).flatMap((l) => (l ?? []).map((a) => a.address)));
  let publicIp: string | null = null;
  const r = await host.exec('curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null');
  if (r.code === 0 && /^\d+\.\d+\.\d+\.\d+$/.test(r.stdout.trim())) publicIp = r.stdout.trim();
  const warnings: string[] = [];
  for (const d of domains) {
    try {
      const ips = await dns.resolve4(d);
      if (!ips.some((ip) => local.has(ip) || ip === publicIp)) {
        warnings.push(`${d} đang trỏ về ${ips.join(', ')}, không phải máy chủ này${publicIp ? ` (${publicIp})` : ''}`);
      }
    } catch {
      warnings.push(`${d} chưa có bản ghi DNS A`);
    }
  }
  return warnings;
}

export async function issueLetsEncrypt(domain: string, domains: string[], email: string, staging: boolean, log: HostLogger) {
  if (!config.dryRun && !(await host.has('certbot'))) throw new Error('Chưa cài certbot (apt install certbot)');
  const args = [
    'certbot certonly --webroot',
    `-w ${shq(config.acmeDir)}`,
    `--cert-name ${shq(domain)}`,
    ...domains.map((d) => `-d ${shq(d)}`),
    '--non-interactive --agree-tos --keep-until-expiring --expand',
    `-m ${shq(email)}`,
    `--deploy-hook ${shq('systemctl reload nginx')}`,
    staging ? '--staging' : '',
  ].filter(Boolean);
  await host.mutate(args.join(' '), { log, timeoutMs: 5 * 60_000 });
}

export async function renewLetsEncrypt(domain: string, log: HostLogger) {
  await host.mutate(`certbot renew --cert-name ${shq(domain)} --force-renewal --deploy-hook ${shq('systemctl reload nginx')}`, { log, timeoutMs: 5 * 60_000 });
}

export async function deleteLetsEncrypt(domain: string, log?: HostLogger) {
  await host.mutate(`certbot delete --cert-name ${shq(domain)} --non-interactive 2>/dev/null || true`, { log });
}

/** Store an uploaded certificate after checking it parses and matches the key. */
export async function installCustomCert(domain: string, certificate: string, privateKey: string) {
  const paths = certPaths(domain, 'custom');
  const dir = path.dirname(paths.certificate);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmpCert = `${paths.certificate}.new`;
  const tmpKey = `${paths.privateKey}.new`;
  await fs.writeFile(tmpCert, certificate.trim() + '\n', { mode: 0o644 });
  await fs.writeFile(tmpKey, privateKey.trim() + '\n', { mode: 0o600 });
  try {
    const certPub = await host.run(`openssl x509 -noout -pubkey -in ${shq(tmpCert)}`);
    const keyPub = await host.run(`openssl pkey -pubout -in ${shq(tmpKey)}`);
    if (certPub.trim() !== keyPub.trim()) throw new Error('Private key không khớp với certificate');
  } catch (err) {
    await Promise.all([fs.rm(tmpCert, { force: true }), fs.rm(tmpKey, { force: true })]);
    throw err instanceof Error && err.message.includes('không khớp') ? err : new Error('Certificate hoặc private key không đọc được');
  }
  await fs.rename(tmpCert, paths.certificate);
  await fs.rename(tmpKey, paths.privateKey);
  return paths;
}

export async function removeCustomCert(domain: string) {
  await fs.rm(path.dirname(certPaths(domain, 'custom').certificate), { recursive: true, force: true });
}
