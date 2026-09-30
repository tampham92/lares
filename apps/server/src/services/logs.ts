import fs from 'node:fs';
import fsp from 'node:fs/promises';
import readline from 'node:readline';
import zlib from 'node:zlib';
import type { LogTail, LogrotateSettings, TrafficStats } from '@tpanel/shared';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db/index.js';
import { host } from './host.js';

/** Read the last `lines` lines (optionally filtered) without loading the whole file. */
export async function tailFile(file: string, lines: number, filter?: string, maxBytes = 16 * 1024 * 1024): Promise<LogTail> {
  const stat = await fsp.stat(file).catch(() => null);
  if (!stat) return { file, sizeBytes: 0, lines: [], truncated: false };
  const needle = filter?.toLowerCase();
  const fh = await fsp.open(file, 'r');
  try {
    const chunk = 256 * 1024;
    let pos = stat.size;
    let carry = '';
    const out: string[] = [];
    let readBytes = 0;
    while (pos > 0 && out.length < lines && readBytes < maxBytes) {
      const len = Math.min(chunk, pos);
      pos -= len;
      readBytes += len;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, pos);
      const parts = (buf.toString('utf8') + carry).split('\n');
      carry = parts.shift() ?? '';
      for (let i = parts.length - 1; i >= 0 && out.length < lines; i--) {
        const l = parts[i]!;
        if (l && (!needle || l.toLowerCase().includes(needle))) out.push(l);
      }
    }
    if (pos === 0 && carry && out.length < lines && (!needle || carry.toLowerCase().includes(needle))) out.push(carry);
    return { file, sizeBytes: stat.size, lines: out.reverse(), truncated: pos > 0 };
  } finally {
    await fh.close();
  }
}

// $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" [$request_time]
const LINE_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"(?: (\d+(?:\.\d+)?))?/;
const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** Parse nginx $time_local: 10/Oct/2026:13:55:36 +0700 */
export function parseNginxTime(s: string): number | null {
  const m = s.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/);
  if (!m) return null;
  const month = MONTHS[m[2]!];
  if (month === undefined) return null;
  const utc = Date.UTC(+m[3]!, month, +m[1]!, +m[4]!, +m[5]!, +m[6]!);
  const offset = (+m[8]! * 60 + +m[9]!) * 60_000 * (m[7] === '+' ? 1 : -1);
  return utc - offset;
}

export interface ParsedLine {
  ip: string;
  time: number;
  method: string;
  path: string;
  status: number;
  bytes: number;
  referrer: string;
  userAgent: string;
  responseTime: number | null;
}

export function parseAccessLine(line: string): ParsedLine | null {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const time = parseNginxTime(m[2]!);
  if (time === null) return null;
  const [method = '', rawPath = ''] = m[3]!.split(' ');
  return {
    ip: m[1]!,
    time,
    method,
    path: rawPath.split('?')[0] || rawPath,
    status: Number(m[4]),
    bytes: m[5] === '-' ? 0 : Number(m[5]),
    referrer: m[6]!,
    userAgent: m[7]!,
    responseTime: m[8] ? Number(m[8]) : null,
  };
}

class Counter {
  private map = new Map<string, number>();
  add(key: string) {
    this.map.set(key, (this.map.get(key) ?? 0) + 1);
  }
  top(n: number) {
    return [...this.map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([key, count]) => ({ key, count }));
  }
  get size() {
    return this.map.size;
  }
}

/** Current log + rotated siblings (access.log.1, access.log.2.gz, ...) that may cover the range. */
async function logFilesSince(file: string, from: number): Promise<string[]> {
  const files = [file];
  for (let i = 1; i <= 60; i++) {
    const candidates = [`${file}.${i}`, `${file}.${i}.gz`];
    const found = await Promise.all(candidates.map((c) => fsp.stat(c).then((s) => ({ c, s }), () => null)));
    const hit = found.find(Boolean);
    if (!hit) break;
    files.push(hit.c);
    if (hit.s.mtimeMs < from) break; // older files end before the range starts
  }
  return files;
}

export async function trafficStats(file: string, rangeHours: number, topN = 10): Promise<TrafficStats> {
  const to = Date.now();
  const from = to - rangeHours * 3_600_000;
  const bucketMs = rangeHours <= 48 ? 3_600_000 : 86_400_000;
  const buckets = new Map<number, { requests: number; bytes: number; errors: number }>();
  for (let t = Math.floor(from / bucketMs) * bucketMs; t <= to; t += bucketMs) buckets.set(t, { requests: 0, bytes: 0, errors: 0 });

  const ips = new Counter();
  const paths = new Counter();
  const refs = new Counter();
  const uas = new Counter();
  const statuses = new Counter();
  const classes: TrafficStats['statusClasses'] = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 };
  let total = 0;
  let bytes = 0;
  let rtSum = 0;
  let rtCount = 0;
  let parsed = 0;
  let skipped = 0;

  for (const f of await logFilesSince(file, from)) {
    const raw = fs.createReadStream(f);
    const input = f.endsWith('.gz') ? raw.pipe(zlib.createGunzip()) : raw;
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (!line) continue;
        const p = parseAccessLine(line);
        if (!p) {
          skipped++;
          continue;
        }
        parsed++;
        if (p.time < from || p.time > to) continue;
        total++;
        bytes += p.bytes;
        ips.add(p.ip);
        paths.add(p.path);
        statuses.add(String(p.status));
        if (p.referrer && p.referrer !== '-') refs.add(p.referrer);
        uas.add(p.userAgent || '-');
        const cls = p.status >= 200 && p.status < 600 ? (`${Math.floor(p.status / 100)}xx` as keyof typeof classes) : 'other';
        classes[cls in classes ? cls : 'other']++;
        if (p.responseTime !== null) {
          rtSum += p.responseTime;
          rtCount++;
        }
        const b = buckets.get(Math.floor(p.time / bucketMs) * bucketMs);
        if (b) {
          b.requests++;
          b.bytes += p.bytes;
          if (p.status >= 500) b.errors++;
        }
      }
    } catch {
      skipped++; // unreadable/corrupt rotated file - keep what we have
    } finally {
      rl.close();
      raw.destroy();
    }
  }

  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    totalRequests: total,
    uniqueIps: ips.size,
    bytesSent: bytes,
    avgResponseMs: rtCount ? Math.round((rtSum / rtCount) * 1000) : null,
    statusClasses: classes,
    topPaths: paths.top(topN),
    topIps: ips.top(topN),
    topReferrers: refs.top(topN),
    topUserAgents: uas.top(topN),
    topStatus: statuses.top(topN),
    timeline: [...buckets.entries()].map(([t, v]) => ({ t: new Date(t).toISOString(), ...v })),
    parsedLines: parsed,
    skippedLines: skipped,
  };
}

export async function truncateLog(file: string) {
  // Truncate in place: nginx keeps its file descriptor, so deleting would make it write to an unlinked file.
  await fsp.truncate(file, 0).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
}

// ---------------------------------------------------------------------------
// logrotate
// ---------------------------------------------------------------------------

export const DEFAULT_LOGROTATE: LogrotateSettings = { retentionDays: 14, compress: true };

export const getLogrotate = () => getSetting<LogrotateSettings>('logrotate', DEFAULT_LOGROTATE);

export function renderLogrotate(s: LogrotateSettings): string {
  return `# Managed by TPanel
${config.siteLogDir}/*/*.log {
    daily
    rotate ${s.retentionDays}
    missingok
    notifempty
${s.compress ? '    compress\n    delaycompress\n' : ''}${s.maxSizeMb ? `    maxsize ${s.maxSizeMb}M\n` : ''}    create 0640 ${config.webUser} adm
    sharedscripts
    postrotate
        [ -s /run/nginx.pid ] && kill -USR1 "$(cat /run/nginx.pid)"
    endscript
}
`;
}

export async function saveLogrotate(s: LogrotateSettings) {
  setSetting('logrotate', s);
  await host.writeFile(config.logrotateFile, renderLogrotate(s));
}
