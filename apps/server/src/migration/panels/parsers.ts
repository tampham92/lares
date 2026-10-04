/**
 * Pure parsers for web server configs found on source servers.
 * Input is a "dump": several files concatenated, each preceded by `### FILE: <path>`.
 */

export interface ParsedVhost {
  file: string;
  serverNames: string[];
  root: string | null;
  phpVersion: string | null;
  proxyPass: string | null;
  includes: string[];
}

export function splitDump(dump: string): Array<{ file: string; content: string }> {
  const out: Array<{ file: string; content: string }> = [];
  const parts = dump.split(/^### FILE: /m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nl = part.indexOf('\n');
    const file = (nl === -1 ? part : part.slice(0, nl)).trim();
    out.push({ file, content: nl === -1 ? '' : part.slice(nl + 1) });
  }
  return out;
}

export function detectPhpVersion(text: string): string | null {
  const patterns = [
    /php(\d)\.(\d+)-fpm/i, // /run/php/php8.2-fpm.sock
    /enable-php-(\d)(\d)\.conf/i, // aaPanel
    /ea-php(\d)(\d)/i, // cPanel EasyApache
    /lsphp(\d)(\d)/i, // LiteSpeed
    /alt-php(\d)(\d)/i, // CloudLinux
    /plesk-php(\d)(\d)/i, // Plesk handler id
    /PHP-(\d)_(\d)/, // Hestia backend template
    /php-fpm(\d)(\d)/i, // Remi / misc
    /\/php\/(\d)\.(\d)\//i, // /etc/php/8.1/...
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return `${m[1]}.${m[2]}`;
  }
  return null;
}

const stripComments = (s: string) => s.replace(/(^|[\s;{}])#[^\n]*/g, '$1');

/** Find the matching closing brace for the `{` at `open`. */
function blockEnd(s: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === quote && s[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return s.length - 1;
}

/** Remove nested `{...}` blocks, leaving only directives at this level. */
function topLevel(body: string): string {
  let out = '';
  let depth = 0;
  for (const c of body) {
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0) out += c;
  }
  return out;
}

const unquote = (v: string) => v.replace(/^["']|["']$/g, '');

function directive(text: string, name: string): string[] {
  const re = new RegExp(`(?:^|[\\s;])${name}\\s+([^;]+);`, 'g');
  return [...text.matchAll(re)].map((m) => m[1]!.trim());
}

export function parseNginx(dump: string): ParsedVhost[] {
  const result: ParsedVhost[] = [];
  for (const { file, content } of splitDump(dump)) {
    if (content.includes('# Managed by Lares')) continue; // never offer Lares's own vhosts
    const s = stripComments(content);
    const re = /(?:^|[\s;{}])server\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const open = s.indexOf('{', m.index);
      const end = blockEnd(s, open);
      const body = s.slice(open + 1, end);
      re.lastIndex = end;
      const top = topLevel(body);
      const names = directive(top, 'server_name').flatMap((v) => v.split(/\s+/));
      let root = directive(top, 'root')[0] ?? null;
      if (!root) {
        const loc = body.match(/location\s+\/\s*\{([^}]*)\}/);
        root = loc ? (directive(loc[1]!, 'root')[0] ?? null) : null;
      }
      result.push({
        file,
        serverNames: names,
        root: root ? unquote(root) : null,
        phpVersion: detectPhpVersion(body),
        proxyPass: directive(body, 'proxy_pass')[0] ?? null,
        includes: directive(body, 'include').map(unquote),
      });
    }
  }
  return result;
}

export function parseApache(dump: string): ParsedVhost[] {
  const result: ParsedVhost[] = [];
  for (const { file, content } of splitDump(dump)) {
    if (content.includes('# Managed by Lares')) continue;
    for (const m of content.matchAll(/<VirtualHost[^>]*>([\s\S]*?)<\/VirtualHost>/gi)) {
      const body = m[1]!.replace(/^\s*#.*$/gm, '');
      const get = (name: string) => [...body.matchAll(new RegExp(`^\\s*${name}\\s+(.+)$`, 'gim'))].map((x) => x[1]!.trim());
      const names = [...get('ServerName'), ...get('ServerAlias').flatMap((v) => v.split(/\s+/))];
      const docRoot = get('DocumentRoot')[0];
      const proxy = body.match(/ProxyPass\s+\/\s+(\S+)/i);
      result.push({
        file,
        serverNames: names,
        root: docRoot ? unquote(docRoot) : null,
        phpVersion: detectPhpVersion(body),
        proxyPass: proxy?.[1] ?? null,
        includes: get('Include').map(unquote),
      });
    }
  }
  return result;
}

/** OpenLiteSpeed vhost.conf (CyberPanel). `vhRoot` comes from the directory name. */
export function parseOpenLiteSpeed(dump: string, vhRootFor: (file: string) => { name: string; root: string }): ParsedVhost[] {
  const result: ParsedVhost[] = [];
  for (const { file, content } of splitDump(dump)) {
    const { name, root } = vhRootFor(file);
    const sub = (v: string) => v.replace(/\$VH_ROOT/g, root).replace(/\$VH_NAME/g, name).replace(/\/$/, '');
    const get = (key: string) => content.match(new RegExp(`^\\s*${key}\\s+(.+)$`, 'm'))?.[1]?.trim();
    const aliases = (get('vhAliases') ?? '').split(/[\s,]+/).filter(Boolean).map(sub);
    result.push({
      file,
      serverNames: [sub(get('vhDomain') ?? name), ...aliases],
      root: sub(get('docRoot') ?? '$VH_ROOT/public_html'),
      phpVersion: detectPhpVersion(content),
      proxyPass: null,
      includes: [],
    });
  }
  return result;
}

const HOST_RE = /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/i;

export function cleanHostnames(names: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of names) {
    const n = raw.trim().toLowerCase().replace(/\.$/, '');
    if (!HOST_RE.test(n)) continue; // drops _, localhost, IPs, wildcards, regex names
    seen.add(n);
  }
  return [...seen];
}

/** Choose the canonical domain: prefer the apex when both example.com and www.example.com exist. */
export function pickPrimary(names: string[]): { domain: string; aliases: string[] } | null {
  const clean = cleanHostnames(names);
  if (!clean.length) return null;
  let primary = clean[0]!;
  if (primary.startsWith('www.') && clean.includes(primary.slice(4))) primary = primary.slice(4);
  return { domain: primary, aliases: clean.filter((n) => n !== primary) };
}

export interface RawSite {
  domain: string;
  aliases: string[];
  rootPath: string | null;
  phpVersion: string | null;
  proxyPass: string | null;
  owner: string | null;
  discoveredBy: string;
}

/** Merge vhosts describing the same site (e.g. :80 and :443 blocks). */
export function vhostsToSites(vhosts: ParsedVhost[], by: string): RawSite[] {
  const map = new Map<string, RawSite>();
  for (const v of vhosts) {
    const p = pickPrimary(v.serverNames);
    if (!p) continue;
    const existing = map.get(p.domain);
    if (existing) {
      existing.aliases = [...new Set([...existing.aliases, ...p.aliases])];
      existing.rootPath ??= v.root;
      existing.phpVersion ??= v.phpVersion;
      existing.proxyPass ??= v.proxyPass;
      continue;
    }
    map.set(p.domain, { ...p, rootPath: v.root, phpVersion: v.phpVersion, proxyPass: v.proxyPass, owner: null, discoveredBy: `${by}: ${v.file}` });
  }
  return [...map.values()];
}

/** Parse Hestia/Vesta web.conf: one line per domain of KEY='value' pairs. */
export function parseHestiaWebConf(content: string): Array<Record<string, string>> {
  return content
    .split('\n')
    .filter((l) => l.includes("DOMAIN='"))
    .map((l) => Object.fromEntries([...l.matchAll(/([A-Z_]+)='([^']*)'/g)].map((m) => [m[1]!, m[2]!])));
}

/** `grep -H` output of cPanel userdata files -> one record per file. */
export function parseCpanelUserdata(grepOutput: string): Array<{ file: string; user: string; fields: Record<string, string> }> {
  const byFile = new Map<string, Record<string, string>>();
  for (const line of grepOutput.split('\n')) {
    const m = line.match(/^(\/var\/cpanel\/userdata\/[^:]+):(\w+):\s*(.*)$/);
    if (!m) continue;
    const rec = byFile.get(m[1]!) ?? {};
    rec[m[2]!] = m[3]!.trim().replace(/^['"]|['"]$/g, '');
    byFile.set(m[1]!, rec);
  }
  return [...byFile.entries()].map(([file, fields]) => ({ file, user: file.split('/')[4] ?? '', fields }));
}
