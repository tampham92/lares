import path from 'node:path';
import type { AppType, DbCredentials } from '@tpanel/shared';
import type { Executor } from '../executors/index.js';
import { shq } from '../lib/shell.js';

// ---------------------------------------------------------------------------
// Pure parsers (unit tested)
// ---------------------------------------------------------------------------

function unescapePhp(v: string, quote: string): string {
  return quote === "'" ? v.replace(/\\(['\\])/g, '$1') : v.replace(/\\(["\\$])/g, '$1');
}

export function phpDefine(src: string, key: string): string | null {
  const re = new RegExp(`define\\s*\\(\\s*(['"])${key}\\1\\s*,\\s*(['"])((?:\\\\.|(?!\\2)[^\\\\])*)\\2\\s*\\)`, 'i');
  const m = src.match(re);
  return m ? unescapePhp(m[3]!, m[2]!) : null;
}

/** DB_HOST forms: "localhost", "127.0.0.1:3307", "localhost:/var/run/mysqld/mysqld.sock", "[::1]:3306" */
export function parseDbHost(raw: string): { host: string; port?: number; socket?: string } {
  const v = raw.trim() || 'localhost';
  const sock = v.match(/^([^:]*):(\/.+)$/);
  if (sock) return { host: sock[1] || 'localhost', socket: sock[2] };
  const v6 = v.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) return { host: v6[1]!, port: v6[2] ? Number(v6[2]) : undefined };
  const hp = v.match(/^([^:]+):(\d+)$/);
  if (hp) return { host: hp[1]!, port: Number(hp[2]) };
  return { host: v };
}

export function parseWpConfig(src: string): DbCredentials | null {
  const name = phpDefine(src, 'DB_NAME');
  const user = phpDefine(src, 'DB_USER');
  if (!name || !user) return null;
  const prefix = src.match(/\$table_prefix\s*=\s*(['"])([A-Za-z0-9_]*)\1/)?.[2] ?? 'wp_';
  return { ...parseDbHost(phpDefine(src, 'DB_HOST') ?? 'localhost'), name, user, password: phpDefine(src, 'DB_PASSWORD') ?? '', prefix };
}

export function parseDotEnv(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?$/);
    if (!m) continue;
    let v = (m[2] ?? '').trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.lastIndexOf(q) > 0) {
      v = v.slice(1, v.lastIndexOf(q));
      if (q === '"') v = v.replace(/\\n/g, '\n').replace(/\\(["\\$])/g, '$1');
    } else {
      v = v.replace(/\s+#.*$/, '');
    }
    out[m[1]!] = v;
  }
  return out;
}

export function dbFromEnv(env: Record<string, string>): DbCredentials | null {
  if (env.DB_CONNECTION && !/mysql|mariadb/i.test(env.DB_CONNECTION)) return null;
  const name = env.DB_DATABASE ?? env.DB_NAME;
  const user = env.DB_USERNAME ?? env.DB_USER;
  if (!name || !user) return null;
  return {
    host: env.DB_HOST || 'localhost',
    port: env.DB_PORT ? Number(env.DB_PORT) : undefined,
    socket: env.DB_SOCKET || undefined,
    name,
    user,
    password: env.DB_PASSWORD ?? env.DB_PASS ?? '',
  };
}

/** Rewrite DB_* keys in a .env file, keeping everything else (comments, order) intact. */
export function rewriteDotEnv(src: string, values: Record<string, string>): string {
  const pending = new Map(Object.entries(values));
  const lines = src.split('\n').map((line) => {
    const m = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m || !pending.has(m[2]!)) return line;
    const v = pending.get(m[2]!)!;
    pending.delete(m[2]!);
    return `${m[1]}${m[2]}=${v}`;
  });
  for (const [k, v] of pending) lines.push(`${k}=${v}`);
  return lines.join('\n');
}

export function isNextPackage(pkgJson: string): boolean {
  try {
    const pkg = JSON.parse(pkgJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return Boolean(pkg.dependencies?.next ?? pkg.devDependencies?.next);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Remote probe
// ---------------------------------------------------------------------------

export interface ProbeResult {
  exists: boolean;
  rootPath: string;
  webRootSubdir: string;
  appType: AppType;
  configPath: string | null;
  db: DbCredentials | null;
  sizeBytes: number | null;
  owner: string | null;
}

const PROBE_FILES = ['wp-config.php', '../wp-config.php', '.env', '../.env', 'artisan', '../artisan', 'package.json', 'index.php', 'index.html', '.next'];
const CAPTURE_FILES = ['wp-config.php', '../wp-config.php', '.env', '../.env', 'package.json'];

export async function probeSite(ex: Executor, root: string): Promise<ProbeResult> {
  const script = `
cd ${shq(root)} 2>/dev/null || { echo '@@MISSING'; exit 0; }
for f in ${PROBE_FILES.join(' ')}; do [ -e "$f" ] && echo "@@HAS $f"; done
echo "@@OWNER $(stat -c '%U' . 2>/dev/null || stat -f '%Su' . 2>/dev/null)"
echo "@@SIZE $( { if command -v timeout >/dev/null 2>&1; then timeout 30 du -sk .; else du -sk .; fi; } 2>/dev/null | cut -f1)"
for f in ${CAPTURE_FILES.join(' ')}; do [ -f "$f" ] && { echo "@@FILE $f"; head -c 200000 "$f"; echo; echo "@@ENDFILE"; }; done
true`;
  const r = await ex.exec(script, { timeoutMs: 90_000 });
  const out = r.stdout;
  const base: ProbeResult = { exists: false, rootPath: root, webRootSubdir: '', appType: 'unknown', configPath: null, db: null, sizeBytes: null, owner: null };
  if (out.includes('@@MISSING')) return base;

  const has = new Set([...out.matchAll(/^@@HAS (.+)$/gm)].map((m) => m[1]!.trim()));
  const files = new Map<string, string>();
  for (const m of out.matchAll(/^@@FILE (.+)\n([\s\S]*?)\n@@ENDFILE$/gm)) files.set(m[1]!.trim(), m[2]!);
  const sizeKb = Number(out.match(/^@@SIZE (\d+)/m)?.[1]);
  const res: ProbeResult = {
    ...base,
    exists: true,
    owner: out.match(/^@@OWNER (\S+)/m)?.[1] ?? null,
    sizeBytes: Number.isFinite(sizeKb) ? sizeKb * 1024 : null,
  };

  if (has.has('wp-config.php') || has.has('../wp-config.php')) {
    res.appType = 'wordpress';
    const inside = files.get('wp-config.php');
    const src = inside ?? files.get('../wp-config.php') ?? '';
    // Webinoly (and hardened installs) keep wp-config.php one level above the web root
    if (!inside) res.configPath = path.posix.join(path.posix.dirname(root), 'wp-config.php');
    res.db = parseWpConfig(src);
  } else if (has.has('package.json') && isNextPackage(files.get('package.json') ?? '')) {
    res.appType = 'nextjs';
  } else if (has.has('../artisan') && path.posix.basename(root) === 'public') {
    // Panel points at laravel/public: migrate the whole project, serve its public/ dir
    res.appType = 'laravel';
    res.rootPath = path.posix.dirname(root);
    res.webRootSubdir = 'public';
    res.db = dbFromEnv(parseDotEnv(files.get('../.env') ?? ''));
  } else if (has.has('artisan')) {
    res.appType = 'laravel';
    res.webRootSubdir = 'public';
    res.db = dbFromEnv(parseDotEnv(files.get('.env') ?? ''));
  } else if (has.has('index.php')) {
    res.appType = 'php';
    res.db = files.has('.env') ? dbFromEnv(parseDotEnv(files.get('.env')!)) : null;
  } else if (has.has('index.html')) {
    res.appType = 'static';
  }
  return res;
}
