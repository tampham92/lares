import type { ConnectionReport, DbCredentials, DiscoveredSite, DiscoveryResult, SourceInput, ToolAvailability } from '@tpanel/shared';
import { connectSource, detectSameHost, localExecutor, type Executor } from '../executors/index.js';
import { SshExecutor } from '../executors/ssh.js';
import { shq } from '../lib/shell.js';
import { port80Owner } from '../services/nginx.js';
import { findSiteByHostname } from '../services/sites.js';
import { probeSite } from './appDetect.js';
import { detectPanel, discoverRawSites } from './panels/index.js';

export interface SourceSession {
  ex: Executor;
  hostFingerprint: string | null;
  sameHost: boolean;
  sameHostReason?: string;
  close(): Promise<void>;
}

/**
 * Open the source. When the "remote" VPS turns out to be this very machine we drop the SSH session
 * and work locally: no network hop, no SFTP, and we run with TPanel's own (root) privileges.
 */
export async function openSource(source: SourceInput): Promise<SourceSession> {
  const ex = await connectSource(source.connection);
  const hostFingerprint = ex instanceof SshExecutor ? ex.fingerprint : null;
  const same = await detectSameHost(source.connection, ex);
  if (same.same && ex.kind === 'ssh') {
    await ex.close();
    return { ex: localExecutor, hostFingerprint, sameHost: true, sameHostReason: same.reason, close: async () => {} };
  }
  return { ex, hostFingerprint, sameHost: same.same, sameHostReason: same.reason, close: () => ex.close() };
}

export async function withSource<T>(source: SourceInput, fn: (s: SourceSession) => Promise<T>): Promise<T> {
  const s = await openSource(source);
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

export async function detectTools(ex: Executor): Promise<ToolAvailability> {
  const names = { mysqldump: 'mysqldump', mysql: 'mysql', tar: 'tar', gzip: 'gzip', pigz: 'pigz', rsync: 'rsync', sha256sum: 'sha256sum', wpcli: 'wp' };
  const r = await ex.exec(`for t in ${Object.values(names).join(' ')}; do command -v "$t" >/dev/null 2>&1 && echo "$t"; done; true`);
  const found = new Set(r.stdout.split('\n').map((l) => l.trim()));
  return Object.fromEntries(Object.entries(names).map(([k, bin]) => [k, found.has(bin)])) as unknown as ToolAvailability;
}

/** Free bytes on the filesystem holding `dir` (null when unknown). */
export async function freeBytes(ex: Executor, dir: string): Promise<number | null> {
  const r = await ex.exec(`df -Pk ${shq(dir)} 2>/dev/null | tail -1 | awk '{print $4}'`);
  const kb = Number(r.stdout.trim());
  return Number.isFinite(kb) && kb > 0 ? kb * 1024 : null;
}

export async function testConnection(source: SourceInput): Promise<ConnectionReport> {
  return withSource(source, async (s) => {
    const info = await s.ex.run(`hostname; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -sr; id -un`);
    const [hostname = '', os = '', user = ''] = info.split('\n');
    const [tools, tmpFree, detectedPanel] = await Promise.all([detectTools(s.ex), freeBytes(s.ex, '/var/tmp'), detectPanel(s.ex)]);
    const warnings: string[] = [];

    const c = source.connection;
    if (c.mode === 'ssh' && c.useSudo && !s.sameHost) {
      const sudo = await s.ex.exec('true');
      if (sudo.code !== 0) warnings.push('sudo -n thất bại: user SSH cần quyền sudo NOPASSWD để đọc file của các site');
    } else if (user !== 'root' && !s.sameHost) {
      warnings.push(`Đang kết nối bằng user "${user}" (không phải root) - có thể không đọc được file/config của mọi site. Bật "Dùng sudo" nếu cần.`);
    }
    if (!tools.tar || !tools.gzip) warnings.push('VPS nguồn thiếu tar/gzip - không thể nén dữ liệu');
    if (!tools.mysqldump) warnings.push('VPS nguồn thiếu mysqldump - không dump được database (chỉ chuyển được file)');

    if (s.sameHost) {
      const owner = await port80Owner();
      if (owner && owner !== 'nginx') {
        warnings.push(
          `Port 80 đang do "${owner}" (web server của panel nguồn) chiếm. Sau khi chuyển, site trên TPanel chỉ nhận traffic khi bạn dừng web server đó và khởi động nginx của TPanel.`,
        );
      }
      warnings.push('Panel nguồn chạy chung VPS: dữ liệu được copy trực tiếp trên máy (không qua mạng), database được dump sang database mới nên site cũ vẫn chạy song song.');
    }

    return {
      ok: true,
      sameHost: s.sameHost,
      sameHostReason: s.sameHostReason,
      hostname,
      os,
      user,
      detectedPanel,
      hostFingerprint: s.hostFingerprint,
      tools,
      tmpFreeBytes: tmpFree,
      warnings,
    };
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

export async function discoverSites(source: SourceInput): Promise<DiscoveryResult> {
  return withSource(source, async (s) => {
    const { panel, sites: raw } = await discoverRawSites(s.ex, source.panel);
    const warnings: string[] = [];
    const sites = await mapLimit(raw, 4, async (r): Promise<DiscoveredSite> => {
      const base: DiscoveredSite = {
        domain: r.domain,
        aliases: r.aliases,
        rootPath: r.rootPath ?? '',
        webRootSubdir: '',
        configPath: null,
        proxyPass: r.proxyPass,
        phpVersion: r.phpVersion,
        appType: r.proxyPass ? 'nextjs' : 'unknown',
        db: null,
        sizeBytes: null,
        owner: r.owner,
        nestedPaths: [],
        existsOnTarget: Boolean(findSiteByHostname(r.domain)),
        discoveredBy: r.discoveredBy,
      };
      if (!r.rootPath) return base;
      const p = await probeSite(s.ex, r.rootPath);
      if (!p.exists) {
        warnings.push(`${r.domain}: không truy cập được ${r.rootPath}`);
        return base;
      }
      return { ...base, rootPath: p.rootPath, webRootSubdir: p.webRootSubdir, appType: p.appType, configPath: p.configPath, db: p.db, sizeBytes: p.sizeBytes, owner: p.owner ?? r.owner };
    });

    // cPanel addon domains etc. live inside the main site's folder: suggest excluding them.
    for (const site of sites) {
      if (!site.rootPath) continue;
      site.nestedPaths = sites
        .filter((o) => o !== site && o.rootPath.startsWith(site.rootPath + '/'))
        .map((o) => o.rootPath.slice(site.rootPath.length + 1));
    }
    for (const site of sites) {
      if (site.proxyPass && !site.rootPath) warnings.push(`${site.domain}: reverse proxy tới ${site.proxyPass} - hãy nhập thư mục mã nguồn ứng dụng`);
    }
    sites.sort((a, b) => a.domain.localeCompare(b.domain));
    return { panel, sites, warnings };
  });
}

/** Inspect an arbitrary directory on the source (manual entry / proxy sites). */
export async function inspectPath(source: SourceInput, dir: string) {
  return withSource(source, async (s) => probeSite(s.ex, dir));
}

// ---------------------------------------------------------------------------
// MySQL on the source machine
// ---------------------------------------------------------------------------

/** Write a 0600 client option file on the source so the password never appears in argv. */
export async function writeSourceMyCnf(ex: Executor, file: string, c: DbCredentials) {
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const lines = ['[client]', `user="${esc(c.user)}"`, `password="${esc(c.password)}"`];
  if (c.socket) lines.push(`socket="${esc(c.socket)}"`);
  else {
    lines.push(`host="${esc(c.host)}"`);
    if (c.port) lines.push(`port=${c.port}`);
  }
  await ex.run(`umask 077; printf '%s\\n' ${lines.map(shq).join(' ')} > ${shq(file)}`);
}

export async function sourceMysqlIdentity(ex: Executor, cnf: string): Promise<string | null> {
  const r = await ex.exec(`mysql --defaults-extra-file=${shq(cnf)} -N -B -e 'SELECT @@hostname, @@port, @@datadir'`);
  if (r.code !== 0) return null;
  return r.stdout.trim().split('\t').join('|');
}

export async function mysqldumpFlags(ex: Executor): Promise<string[]> {
  const help = await ex.exec('mysqldump --help 2>/dev/null');
  const flags = ['--single-transaction', '--quick', '--triggers', '--hex-blob', '--default-character-set=utf8mb4', '--no-tablespaces', '--add-drop-table'];
  if (help.stdout.includes('--set-gtid-purged')) flags.push('--set-gtid-purged=OFF');
  if (help.stdout.includes('--column-statistics')) flags.push('--column-statistics=0');
  return flags;
}
