import fs from 'node:fs/promises';
import path from 'node:path';
import type { Site } from '@lares/shared';
import { config } from '../config.js';
import { shq } from '../lib/shell.js';
import { host } from './host.js';
import { tailFile } from './logs.js';
import { siteLogPaths } from './nginx.js';
import { fatalKey, findMarkers, isFatalLine, pageTitle, type HealthSnapshot, type PageProbe } from './wpUpdatePolicy.js';

/*
 * Health snapshot of a WordPress site, taken before and after an update: the home page and
 * /wp-login.php fetched through this machine's own nginx (DNS, CDN and the firewall play no part),
 * plus the fatal PHP errors in the site's error logs. Comparing two snapshots: wpUpdatePolicy.ts.
 */

const MARK = '__LARES_PROBE__';
const MAX_HOPS = 5;

/** Hostnames of the site: a redirect to one of them is followed (still on this server). */
function siteHosts(site: Site): Set<string> {
  const names = [site.domain, ...site.aliases].map((h) => h.toLowerCase());
  return new Set(names.flatMap((h) => [h, h.startsWith('www.') ? h.slice(4) : `www.${h}`]));
}

const baseUrl = (site: Site) => (site.listenPort ? `http://127.0.0.1:${site.listenPort}` : `${site.ssl.enabled ? 'https' : 'http'}://${site.domain}`);

/** One GET; `--connect-to ::127.0.0.1:` sends every hostname to the local nginx on the same port. */
async function fetchOnce(url: string): Promise<{ status: number | null; redirect: string; body: string; error?: string }> {
  const r = await host.exec(
    `curl -sS -k -m 20 --connect-to ::127.0.0.1: -A ${shq('Lares-HealthCheck/1.0')} -H ${shq('Cache-Control: no-cache')} -o - -w ${shq(`\\n${MARK} %{http_code} %{redirect_url}`)} ${shq(url)}`,
    { timeoutMs: 30_000 },
  );
  const at = r.stdout.lastIndexOf(`\n${MARK} `);
  const body = at >= 0 ? r.stdout.slice(0, at) : r.stdout;
  const [code = '000', redirect = ''] = (at >= 0 ? r.stdout.slice(at + MARK.length + 2) : '').trim().split(/\s+/, 2);
  const status = /^[1-5]\d\d$/.test(code) ? Number(code) : null;
  return { status, redirect, body, error: status === null ? r.stderr.trim().split('\n').pop() || `curl exit ${r.code}` : undefined };
}

/** Fetch a page of the site, following redirects that stay on the site (http → https, www). */
export async function probePage(site: Site, rel: string): Promise<PageProbe> {
  const hosts = siteHosts(site);
  let url = new URL(rel, `${baseUrl(site)}/`).toString();
  for (let hop = 0; ; hop++) {
    const r = await fetchOnce(url);
    if (r.status !== null && r.status >= 300 && r.status < 400 && r.redirect && hop < MAX_HOPS) {
      const next = URL.canParse(r.redirect, url) ? new URL(r.redirect, url) : null;
      const onSite = next && /^https?:$/.test(next.protocol) && (site.listenPort ? next.port === String(site.listenPort) : hosts.has(next.hostname.toLowerCase()));
      if (next && onSite) {
        url = next.toString();
        continue;
      }
    }
    return { url, status: r.status, error: r.error, title: pageTitle(r.body), markers: findMarkers(r.body), bodyBytes: r.body.trim().length };
  }
}

// ---- Error logs ---------------------------------------------------------------------------

export interface LogMark {
  file: string;
  size: number;
}

/** nginx error log of the site (PHP-FPM errors land there as "FastCGI sent in stderr") and WordPress' debug.log. */
const logFiles = (site: Site) => [siteLogPaths(site.domain).error, path.join(site.webRoot, 'wp-content', 'debug.log')];

/** Regular files only: debug.log lives in the site's own tree, where a symlink could point anywhere. */
async function fileSize(file: string): Promise<number | null> {
  const st = await fs.lstat(file).catch(() => null);
  return st?.isFile() ? st.size : null;
}

/** Current size of each log, so later reads only see what was written after this point. */
export async function markLogs(site: Site): Promise<LogMark[]> {
  const out: LogMark[] = [];
  for (const file of logFiles(site)) out.push({ file, size: (await fileSize(file)) ?? 0 });
  return out;
}

/** Lines appended since `mark` (from the start when the log was rotated meanwhile); at most 1 MB. */
async function linesSince(mark: LogMark): Promise<string[]> {
  const size = await fileSize(mark.file);
  if (size === null) return [];
  const from = size < mark.size ? 0 : mark.size;
  const start = Math.max(from, size - 1024 * 1024);
  if (size <= start) return [];
  const fh = await fs.open(mark.file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    return buf.toString('utf8').split('\n').filter(Boolean);
  } finally {
    await fh.close();
  }
}

const fatals = (lines: string[]) => [...new Set(lines.filter(isFatalLine).map(fatalKey))];

async function recentFatals(site: Site): Promise<string[]> {
  const lines: string[] = [];
  for (const file of logFiles(site)) {
    if ((await fileSize(file)) === null) continue;
    lines.push(...(await tailFile(file, 400, undefined, 2 * 1024 * 1024)).lines);
  }
  return fatals(lines);
}

/** Fatal PHP errors logged since the marks. */
export async function fatalsSince(marks: LogMark[]): Promise<string[]> {
  const lines: string[] = [];
  for (const m of marks) lines.push(...(await linesSince(m)));
  return fatals(lines);
}

/**
 * Snapshot of the site's health. With `since` (log marks taken right before), also the fatal
 * errors logged meanwhile - i.e. caused by these very requests or by visitors at the same time.
 */
export async function takeHealth(site: Site, since?: LogMark[]): Promise<HealthSnapshot> {
  const at = new Date().toISOString();
  if (config.dryRun) {
    const page = (rel: string): PageProbe => ({ url: new URL(rel, `${baseUrl(site)}/`).toString(), status: 200, title: site.domain, markers: [], bodyBytes: 4096 });
    return { at, home: page('/'), login: page('/wp-login.php'), recentFatals: [], newFatals: [] };
  }
  const [home, login] = await Promise.all([probePage(site, `/?lares_health=${Date.now()}`), probePage(site, '/wp-login.php')]);
  return { at, home, login, recentFatals: await recentFatals(site), newFatals: since ? await fatalsSince(since) : [] };
}
