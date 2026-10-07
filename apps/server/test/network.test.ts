import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLOUDFLARE_IPV4,
  CLOUDFLARE_IPV6,
  fetchCloudflareRanges,
  getCloudflareView,
  isCidr,
  parseRangeList,
  refreshCloudflareRanges,
  renderCloudflareConf,
} from '../src/services/cloudflare.js';
import { writeNginxConf } from '../src/services/nginxConf.js';
import { PANEL_DEPLOY_HOOK, panelUrl, renderPanelVhost, upsertEnv } from '../src/services/panelTls.js';
import { config } from '../src/config.js';
import { ngxPath } from '../src/lib/shell.js';

const fakeFetch = (bodies: Record<string, string | number>) => async (url: string) => {
  const b = bodies[url];
  if (b === undefined) throw new Error(`unexpected ${url}`);
  return typeof b === 'number' ? { ok: false, status: b, text: async () => '' } : { ok: true, status: 200, text: async () => b };
};
const V4_URL = 'https://www.cloudflare.com/ips-v4';
const V6_URL = 'https://www.cloudflare.com/ips-v6';

describe('Cloudflare IP ranges', () => {
  it('validates CIDRs per family', () => {
    expect(isCidr('173.245.48.0/20', 4)).toBe(true);
    expect(isCidr('2400:cb00::/32', 6)).toBe(true);
    expect(isCidr('1.2.3.4', 4)).toBe(true);
    expect(isCidr('2400:cb00::/32', 4)).toBe(false);
    expect(isCidr('1.2.3.0/33', 4)).toBe(false);
    expect(isCidr('2400::/129', 6)).toBe(false);
    expect(isCidr('256.1.1.1/8', 4)).toBe(false);
    expect(isCidr('1.2.3.0/24; include /etc/passwd', 4)).toBe(false);
    expect(isCidr('', 4)).toBe(false);
  });

  it('bundled lists are valid', () => {
    expect(CLOUDFLARE_IPV4.every((r) => isCidr(r, 4))).toBe(true);
    expect(CLOUDFLARE_IPV6.every((r) => isCidr(r, 6))).toBe(true);
  });

  it('parses a list, trimming blanks/CRLF and duplicates', () => {
    expect(parseRangeList('173.245.48.0/20\r\n103.21.244.0/22\n\n103.21.244.0/22\n', 4)).toEqual(['173.245.48.0/20', '103.21.244.0/22']);
  });

  it('rejects the whole list on any bad line', () => {
    expect(() => parseRangeList('<html><body>Error</body></html>', 4)).toThrow();
    expect(() => parseRangeList('173.245.48.0/20\nreal_ip_header X-Evil;', 4)).toThrow();
    expect(() => parseRangeList('2400:cb00::/32', 4)).toThrow();
    expect(() => parseRangeList('   \n', 6)).toThrow();
  });

  it('renders set_real_ip_from for every range plus the header', () => {
    const conf = renderCloudflareConf(['173.245.48.0/20', 'garbage;'], ['2400:cb00::/32']);
    expect(conf).toContain('set_real_ip_from 173.245.48.0/20;');
    expect(conf).toContain('set_real_ip_from 2400:cb00::/32;');
    expect(conf).toContain('real_ip_header CF-Connecting-IP;');
    expect(conf).not.toContain('garbage');
    expect(conf.match(/set_real_ip_from/g)).toHaveLength(2);
  });

  it('fetches and validates both lists', async () => {
    const r = await fetchCloudflareRanges(fakeFetch({ [V4_URL]: CLOUDFLARE_IPV4.join('\n'), [V6_URL]: CLOUDFLARE_IPV6.join('\n') }));
    expect(r).toEqual({ ipv4: CLOUDFLARE_IPV4, ipv6: CLOUDFLARE_IPV6 });
    await expect(fetchCloudflareRanges(fakeFetch({ [V4_URL]: 503, [V6_URL]: '2400:cb00::/32' }))).rejects.toThrow(/503/);
    await expect(fetchCloudflareRanges(fakeFetch({ [V4_URL]: '1.1.1.0/24', [V6_URL]: '<!doctype html>' }))).rejects.toThrow();
  });

  it('keeps the previous list when a refresh fails', async () => {
    const before = getCloudflareView();
    await expect(refreshCloudflareRanges(undefined, fakeFetch({ [V4_URL]: 'not an ip', [V6_URL]: '2400:cb00::/32' }))).rejects.toThrow();
    const after = getCloudflareView();
    expect(after.ipv4).toEqual(before.ipv4);
    expect(after.ipv6).toEqual(before.ipv6);
    expect(after.lastError).toBeTruthy();
  });
});

describe('writeNginxConf', () => {
  it('writes, skips unchanged content and rolls back when nginx -t fails', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lares-conf-'));
    const file = path.join(dir, 'x.conf');
    let reloads = 0;
    const ok = async () => void reloads++;
    const fail = async () => {
      throw new Error('nginx -t failed');
    };

    expect(await writeNginxConf(file, 'a', ok)).toBe(true);
    expect(await writeNginxConf(file, 'a', ok)).toBe(false);
    expect(reloads).toBe(1);

    await expect(writeNginxConf(file, 'b', fail)).rejects.toThrow('nginx -t failed');
    expect(await fs.readFile(file, 'utf8')).toBe('a');

    await expect(writeNginxConf(file, null, fail)).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe('a');
    expect(await writeNginxConf(file, null, ok)).toBe(true);
    await expect(fs.access(file)).rejects.toThrow();

    const fresh = path.join(dir, 'new.conf');
    await expect(writeNginxConf(fresh, 'c', fail)).rejects.toThrow();
    await expect(fs.access(fresh)).rejects.toThrow();
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('panel certificate', () => {
  it('updates env entries and keeps every other line', () => {
    const env = '# comment\nNODE_ENV=production\nLARES_TLS_CERT=/etc/lares/panel.crt\nLARES_SECRET=abc=def\n';
    const out = upsertEnv(env, { LARES_TLS_CERT: '/etc/letsencrypt/live/lares-panel/fullchain.pem', LARES_TLS_KEY: '/etc/letsencrypt/live/lares-panel/privkey.pem' });
    expect(out).toBe(
      '# comment\nNODE_ENV=production\nLARES_TLS_CERT=/etc/letsencrypt/live/lares-panel/fullchain.pem\nLARES_SECRET=abc=def\nLARES_TLS_KEY=/etc/letsencrypt/live/lares-panel/privkey.pem\n',
    );
    expect(upsertEnv('', { A: '1' })).toBe('A=1\n');
    expect(() => upsertEnv(env, { A: 'x\nLARES_DRY_RUN=1' })).toThrow();
    expect(() => upsertEnv(env, { 'A B': 'x' })).toThrow();
  });

  it('renders the port-80 block: ACME webroot + redirect to the panel', () => {
    const conf = renderPanelVhost('panel.example.com', 8686);
    expect(conf).toContain('server_name panel.example.com;');
    expect(conf).toContain(`root ${ngxPath(config.acmeDir)};`);
    expect(conf).toContain('return 301 https://panel.example.com:8686$request_uri;');
    expect(panelUrl('panel.example.com', 443)).toBe('https://panel.example.com');
    expect(PANEL_DEPLOY_HOOK).toContain('lares');
  });
});
