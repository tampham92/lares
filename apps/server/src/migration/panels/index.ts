import type { PanelType } from '@lares/shared';
import type { Executor } from '../../executors/index.js';
import { t } from '../../i18n/index.js';
import { shq } from '../../lib/shell.js';
import {
  detectPhpVersion,
  laresSitesFromRows,
  parseLaresVhosts,
  type LaresSiteRow,
  parseApache,
  parseCpanelUserdata,
  parseHestiaWebConf,
  parseNginx,
  parseOpenLiteSpeed,
  pickPrimary,
  vhostsToSites,
  type RawSite,
} from './parsers.js';

export type { RawSite } from './parsers.js';

interface PanelAdapter {
  id: Exclude<PanelType, 'auto' | 'manual'>;
  /** Any of these paths existing means the panel is installed. */
  markers: string[];
  /** `warn`: something the owner should know about the discovery (sites left out...). */
  discover(ex: Executor, warn: (msg: string) => void): Promise<RawSite[]>;
}

/**
 * Concatenate matching files with `### FILE:` separators.
 * Globs are constants defined in this module (never user input), so they are left unquoted to expand.
 */
async function dumpFiles(ex: Executor, globs: string[], exclude: RegExp | null = null): Promise<string> {
  const r = await ex.exec(
    `for f in ${globs.join(' ')}; do [ -f "$f" ] && { printf '### FILE: %s\\n' "$f"; head -c 500000 "$f"; printf '\\n'; }; done; true`,
    { timeoutMs: 60_000 },
  );
  if (!exclude) return r.stdout;
  return r.stdout
    .split(/(?=^### FILE: )/m)
    .filter((part) => !exclude.test(part.split('\n')[0] ?? ''))
    .join('');
}

async function defaultPhp(ex: Executor): Promise<string | null> {
  const r = await ex.exec(`php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;' 2>/dev/null`);
  return /^\d\.\d+$/.test(r.stdout.trim()) ? r.stdout.trim() : null;
}

const aapanel: PanelAdapter = {
  id: 'aapanel',
  markers: ['/www/server/panel'],
  async discover(ex) {
    const skip = /(0\.default|phpfpm_status|0\.site_total|0\.fastcgi)/;
    const nginx = await dumpFiles(ex, ['/www/server/panel/vhost/nginx/*.conf'], skip);
    const sites = vhostsToSites(parseNginx(nginx), 'aaPanel nginx');
    if (sites.length) return sites;
    const apache = await dumpFiles(ex, ['/www/server/panel/vhost/apache/*.conf'], skip);
    return vhostsToSites(parseApache(apache), 'aaPanel apache');
  },
};

const cyberpanel: PanelAdapter = {
  id: 'cyberpanel',
  markers: ['/usr/local/CyberCP'],
  async discover(ex) {
    const dump = await dumpFiles(ex, ['/usr/local/lsws/conf/vhosts/*/vhost.conf'], /\/Example\//);
    const vhosts = parseOpenLiteSpeed(dump, (file) => {
      const name = file.split('/').slice(-2, -1)[0] ?? '';
      return { name, root: `/home/${name}` };
    });
    return vhostsToSites(vhosts, 'CyberPanel').map((s) => ({ ...s, owner: null }));
  },
};

const hestiacp: PanelAdapter = {
  id: 'hestiacp',
  markers: ['/usr/local/hestia', '/usr/local/vesta'],
  async discover(ex) {
    const dump = await dumpFiles(ex, ['/usr/local/hestia/data/users/*/web.conf', '/usr/local/vesta/data/users/*/web.conf']);
    const sites: RawSite[] = [];
    for (const part of dump.split(/(?=^### FILE: )/m)) {
      const file = part.split('\n')[0]?.replace('### FILE: ', '').trim() ?? '';
      const user = file.split('/')[6] ?? '';
      for (const rec of parseHestiaWebConf(part)) {
        const domain = rec.DOMAIN;
        if (!domain) continue;
        const p = pickPrimary([domain, ...(rec.ALIAS ?? '').split(',')]);
        if (!p) continue;
        const docroot = rec.CUSTOM_DOCROOT || `/home/${user}/web/${domain}/public_html`;
        sites.push({
          ...p,
          rootPath: docroot.replace(/\/$/, ''),
          phpVersion: detectPhpVersion(rec.BACKEND ?? ''),
          proxyPass: null,
          owner: user,
          discoveredBy: `HestiaCP: ${file}`,
        });
      }
    }
    return sites;
  },
};

const cpanel: PanelAdapter = {
  id: 'cpanel',
  markers: ['/usr/local/cpanel'],
  async discover(ex) {
    const r = await ex.exec(
      `grep -H -E '^(documentroot|servername|serveralias|phpversion):' /var/cpanel/userdata/*/* 2>/dev/null | grep -v -E '/(main|cache)(\\.[a-z]+)?:|_SSL:|\\.cache:|\\.json:|\\.yaml:'; true`,
      { timeoutMs: 60_000 },
    );
    return parseCpanelUserdata(r.stdout).flatMap((rec) => {
      const p = pickPrimary([rec.fields.servername ?? '', ...(rec.fields.serveralias ?? '').split(/\s+/)]);
      if (!p || !rec.fields.documentroot) return [];
      return [
        {
          ...p,
          rootPath: rec.fields.documentroot,
          phpVersion: detectPhpVersion(rec.fields.phpversion ?? ''),
          proxyPass: null,
          owner: rec.user,
          discoveredBy: `cPanel: ${rec.file}`,
        },
      ];
    });
  },
};

const directadmin: PanelAdapter = {
  id: 'directadmin',
  markers: ['/usr/local/directadmin'],
  async discover(ex) {
    const r = await ex.exec(
      `for d in /usr/local/directadmin/data/users/*/; do u=$(basename "$d"); [ -f "$d/domains.list" ] && while read -r dom; do [ -n "$dom" ] && echo "$u $dom"; done < "$d/domains.list"; done; true`,
    );
    const php = await defaultPhp(ex);
    return r.stdout
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .flatMap(([user, domain]) => {
        const p = user && domain ? pickPrimary([domain, `www.${domain}`]) : null;
        return p
          ? [{ ...p, rootPath: `/home/${user}/domains/${domain}/public_html`, phpVersion: php, proxyPass: null, owner: user!, discoveredBy: 'DirectAdmin domains.list' }]
          : [];
      });
  },
};

const cloudpanel: PanelAdapter = {
  id: 'cloudpanel',
  markers: ['/home/clp', '/usr/bin/clpctl'],
  async discover(ex) {
    const dump = await dumpFiles(ex, ['/etc/nginx/sites-enabled/*']);
    const sites = vhostsToSites(parseNginx(dump), 'CloudPanel');
    return sites.map((s) => ({ ...s, owner: s.rootPath?.match(/^\/home\/([^/]+)\//)?.[1] ?? null }));
  },
};

const plesk: PanelAdapter = {
  id: 'plesk',
  markers: ['/usr/local/psa'],
  async discover(ex) {
    const r = await ex.exec(`plesk db -Ne "SELECT d.name, h.www_root, IFNULL(h.php_handler_id,'') FROM domains d JOIN hosting h ON h.dom_id = d.id" 2>/dev/null`);
    if (r.code === 0 && r.stdout.trim()) {
      return r.stdout
        .split('\n')
        .map((l) => l.split('\t'))
        .flatMap(([name, root, handler]) => {
          const p = name && root ? pickPrimary([name, `www.${name}`]) : null;
          return p ? [{ ...p, rootPath: root!, phpVersion: detectPhpVersion(handler ?? ''), proxyPass: null, owner: null, discoveredBy: 'Plesk DB' }] : [];
        });
    }
    const ls = await ex.exec(`for d in /var/www/vhosts/*/httpdocs; do [ -d "$d" ] && echo "$d"; done; true`);
    return ls.stdout
      .split('\n')
      .filter(Boolean)
      .flatMap((root) => {
        const p = pickPrimary([root.split('/')[4] ?? '']);
        return p ? [{ ...p, aliases: [`www.${p.domain}`], rootPath: root, phpVersion: null, proxyPass: null, owner: null, discoveredBy: 'Plesk vhosts' }] : [];
      });
  },
};

const webinoly: PanelAdapter = {
  id: 'webinoly',
  markers: ['/opt/webinoly'],
  async discover(ex) {
    // Webinoly vhosts are extension-less files named after the domain; proxy targets live in apps.d
    const dump = await dumpFiles(ex, ['/etc/nginx/sites-enabled/*', '/etc/nginx/apps.d/*proxy*'], /\/(default|webinoly\.conf)$/);
    const vhosts = parseNginx(dump);
    const proxyFiles = new Map<string, string>();
    for (const part of dump.split(/(?=^### FILE: )/m)) {
      const file = part.split('\n')[0]?.replace('### FILE: ', '').trim() ?? '';
      const pp = part.match(/proxy_pass\s+([^;]+);/);
      if (file.includes('/apps.d/') && pp) proxyFiles.set(file.split('/').pop()!, pp[1]!.trim());
    }
    const php = await defaultPhp(ex);
    return vhostsToSites(vhosts, 'Webinoly').map((s) => {
      const vh = vhosts.find((v) => v.serverNames.includes(s.domain));
      const proxyInclude = vh?.includes.find((i) => i.includes('proxy'));
      const proxy = s.proxyPass ?? (proxyInclude ? (proxyFiles.get(proxyInclude.split('/').pop()!) ?? null) : null);
      return {
        ...s,
        rootPath: s.rootPath ?? (proxy ? null : `/var/www/${s.domain}/htdocs`),
        phpVersion: s.phpVersion ?? (proxy ? null : php),
        proxyPass: proxy,
      };
    });
  },
};

/*
 * Another Lares panel (moving to a new VPS). Its vhosts carry "# Managed by Lares", which every other
 * adapter skips so that this panel never offers its own sites; the source's database lists them
 * exactly instead (folder, app type, PHP version, status). Read-only, never through the source's
 * panel: sqlite3 when installed, else Node with the panel's own better-sqlite3 (in src, or in src.old
 * left by an upgrade). When neither works (a half-finished upgrade on the source), its vhosts.
 */
const LARES_SITES_QUERY = 'SELECT domain, aliases_json, root_path, web_root, php_version, app_type, app_port, listen_port, status FROM sites ORDER BY domain';
const LARES_NODE_READ = 'const D = require("better-sqlite3"); const db = new D(process.argv[1], { readonly: true, fileMustExist: true }); process.stdout.write(JSON.stringify(db.prepare(process.argv[2]).all()));';

async function laresRows(ex: Executor): Promise<LaresSiteRow[] | null> {
  const script = [
    `dir=$(grep -E '^LARES_DATA_DIR=' /etc/lares/lares.env 2>/dev/null | tail -n 1 | cut -d= -f2-)`,
    'db="${dir:-/var/lib/lares}/lares.db"',
    '[ -f "$db" ] || exit 3',
    `if command -v sqlite3 >/dev/null 2>&1 && sqlite3 -readonly -json "$db" ${shq(LARES_SITES_QUERY)} 2>/dev/null; then exit 0; fi`,
    'for d in /opt/lares/src /opt/lares/src.old; do',
    '  [ -d "$d/node_modules/better-sqlite3" ] || continue',
    `  (cd "$d" && /usr/bin/node -e ${shq(LARES_NODE_READ)} "$db" ${shq(LARES_SITES_QUERY)} 2>/dev/null) && exit 0`,
    'done',
    'exit 4',
  ].join('\n');
  const r = await ex.exec(script, { timeoutMs: 60_000 });
  if (r.code !== 0) return null;
  try {
    const rows: unknown = JSON.parse(r.stdout.trim() || '[]');
    return Array.isArray(rows) ? (rows as LaresSiteRow[]) : null;
  } catch {
    return null;
  }
}

const lares: PanelAdapter = {
  id: 'lares',
  markers: ['/etc/lares/lares.env'],
  async discover(ex, warn) {
    // this machine's own Lares (same-VPS migration): nothing to move onto itself
    if (ex.kind === 'local') return [];
    const rows = await laresRows(ex);
    let found;
    if (rows) found = laresSitesFromRows(rows);
    else {
      warn(t('Không đọc được database của Lares nguồn: danh sách site lấy từ vhost nginx (phiên bản PHP và thư mục của site đang tắt có thể cần sửa tay)'));
      found = parseLaresVhosts(await dumpFiles(ex, ['/etc/nginx/sites-enabled/*.conf']));
    }
    if (found.skipped.length) {
      warn(t('Bỏ qua site chạy theo port (chưa có tên miền): {sites}. Gán tên miền cho site trên Lares nguồn, hoặc nhập thủ công.', { sites: found.skipped.join(', ') }));
    }
    return found.sites;
  },
};

const generic: PanelAdapter = {
  id: 'generic',
  markers: [],
  async discover(ex) {
    const nginx = await dumpFiles(
      ex,
      ['/etc/nginx/sites-enabled/*', '/etc/nginx/conf.d/*.conf', '/usr/local/nginx/conf/vhost/*.conf', '/usr/local/nginx/conf/conf.d/*.conf'],
      /\/default(\.conf)?$/,
    );
    const apache = await dumpFiles(ex, ['/etc/apache2/sites-enabled/*', '/etc/httpd/conf.d/*.conf', '/etc/httpd/sites-enabled/*']);
    const php = await defaultPhp(ex);
    return [...vhostsToSites(parseNginx(nginx), 'nginx'), ...vhostsToSites(parseApache(apache), 'apache')].map((s) => ({
      ...s,
      phpVersion: s.phpVersion ?? (s.proxyPass ? null : php),
    }));
  },
};

/**
 * Order matters: specific panels first, generic nginx/apache scan last. Lares after the others: on a
 * machine where Lares was installed next to another panel, that panel's sites are the ones to move.
 */
export const ADAPTERS: PanelAdapter[] = [cpanel, plesk, directadmin, cyberpanel, hestiacp, aapanel, webinoly, cloudpanel, lares, generic];

export async function detectPanel(ex: Executor): Promise<Exclude<PanelType, 'auto' | 'manual'>> {
  // locally, /etc/lares is this panel itself, not a source
  const markers = ADAPTERS.filter((a) => a !== lares || ex.kind !== 'local').flatMap((a) => a.markers);
  const r = await ex.exec(`for p in ${markers.map((m) => `'${m}'`).join(' ')}; do [ -e "$p" ] && echo "$p"; done; true`);
  const found = new Set(r.stdout.split('\n').map((l) => l.trim()));
  return ADAPTERS.find((a) => a.markers.some((m) => found.has(m)))?.id ?? 'generic';
}

export async function discoverRawSites(ex: Executor, panel: PanelType): Promise<{ panel: PanelType; sites: RawSite[]; warnings: string[] }> {
  if (panel === 'manual') return { panel, sites: [], warnings: [] };
  const id = panel === 'auto' ? await detectPanel(ex) : panel;
  const adapter = ADAPTERS.find((a) => a.id === id) ?? generic;
  const warnings: string[] = [];
  const warn = (msg: string) => warnings.push(msg);
  let sites = await adapter.discover(ex, warn);
  // A panel with non-standard layout: fall back to scanning the web server configs directly.
  if (!sites.length && adapter !== generic) sites = await generic.discover(ex, warn);
  return { panel: id, sites, warnings };
}
