import { describe, expect, it } from 'vitest';
import { wpVulnCount, type WpInventory } from '@lares/shared';
import { db } from '../src/db/index.js';
import { getSecuritySettings, saveSecuritySettings } from '../src/services/securityStore.js';
import { affects, alertItems, freshAlerts, lookupsFor, matchInventory, parseVulnResponse, type Lookup, type StoredVuln } from '../src/services/wpVulnPolicy.js';
import { hasDueLookups, refreshVulns, setVulnFetch, siteVulns } from '../src/services/wpVulns.js';

// Shapes copied from real WPVulnerability answers (2026-10), trimmed
const op = (o: Partial<Record<'min_version' | 'min_operator' | 'max_version' | 'max_operator' | 'unfixed', string | null>>) => ({
  min_version: null,
  min_operator: null,
  max_version: null,
  max_operator: null,
  unfixed: '0',
  closed: '0',
  ...o,
});

const ELEMENTOR = {
  error: 0,
  message: null,
  data: {
    name: 'Elementor Website Builder',
    plugin: 'elementor',
    vulnerability: [
      {
        uuid: '928f0366f173e177a53a0111b0e15c69725965512998f3ddd9b38e84ae540d03',
        name: 'Elementor Website Builder &#8211; more than just a page builder [elementor] < 4.2.4',
        operator: op({ max_version: '4.2.4', max_operator: 'lt' }),
        source: [
          { id: 'CVE-2026-11905', name: 'CVE-2026-11905', link: 'https://www.cve.org/CVERecord?id=CVE-2026-11905', description: '[en] The Elementor plugin is vulnerable to Sensitive Information Exposure.' },
          {
            id: '8da60057f4c60149d9de37dac3a6ae051ea4e56e',
            name: "Elementor Website Builder <= 4.2.3 - Missing Authorization to Sensitive Information Exposure via 'keys_conversion_map'",
            link: 'https://www.wordfence.com/threat-intel/vulnerabilities/wordpress-plugins/elementor/elementor-423',
          },
        ],
        impact: { cvss: { score: '4.3', severity: 'm' }, cvss3: { score: '4.3', severity: 'medium' } },
      },
      {
        uuid: 'aa11bb22cc33dd44ee55ff6600778899aabbccddeeff00112233445566778899',
        name: 'Elementor [elementor] >= 3.6.0 <= 3.6.2',
        operator: op({ min_version: '3.6.0', min_operator: 'ge', max_version: '3.6.2', max_operator: 'le' }),
        source: [{ id: 'CVE-2022-1329', name: 'CVE-2022-1329', link: 'https://www.cve.org/CVERecord?id=CVE-2022-1329', description: '[en] Remote Code Execution <script>x</script>' }],
        impact: { cvss3: { score: '9.9', severity: 'critical' } },
      },
      // no bound at all: not guessed about
      { uuid: 'bad00000-0000-0000-0000-000000000000', name: 'x', operator: op({}), source: [] },
      // an http link is not kept
      {
        uuid: 'cc00000000000000000000000000000000000000000000000000000000000001',
        name: 'Elementor [elementor] < 1.0',
        operator: op({ max_version: '1.0', max_operator: 'lt' }),
        source: [{ id: 'x1', name: 'Old one', link: 'http://example.com/advisory' }],
      },
    ],
  },
};

const FLATSOME = {
  error: 0,
  data: {
    theme: 'flatsome',
    vulnerability: [
      {
        uuid: 'ff00000000000000000000000000000000000000000000000000000000000001',
        name: 'Flatsome [flatsome] <= 3.20.5 (unfixed)',
        operator: op({ max_version: '3.20.5', max_operator: 'le', unfixed: '1' }),
        source: [{ id: 'f1', name: 'Flatsome <= 3.20.5 - Reflected XSS', link: 'https://patchstack.com/database/flatsome' }],
        impact: { cvss3: { score: '7.1', severity: 'high' } },
      },
    ],
  },
};

const CORE = {
  error: 0,
  data: {
    core: '6.4.1',
    vulnerability: [
      { uuid: 'c0re0000000000000000000000000000000000000000000000000000000000001', name: '6.4.1', source: [{ id: 'CVE-2025-58674', name: 'CVE-2025-58674', link: 'https://www.cve.org/CVERecord?id=CVE-2025-58674', description: '[en] Stored XSS in the menu.' }], impact: { cvss3: { severity: 'medium', score: '5.4' } } },
    ],
  },
};

const UNKNOWN_SLUG = { error: 0, message: null, data: { name: null, plugin: 'nope', link: null, latest: null, closed: null, vulnerability: null } };

const inv = (over: Partial<WpInventory> = {}): WpInventory => ({
  core: { version: '6.4.1', update: '6.8.3' },
  plugins: [
    { slug: 'elementor', title: 'Elementor', status: 'active', version: '4.2.3', update: '4.2.4', autoUpdate: false },
    { slug: 'nope', title: 'Nope', status: 'inactive', version: '1.0', update: null, autoUpdate: false },
  ],
  themes: [{ slug: 'flatsome', title: 'Flatsome', status: 'active', version: '3.19.0', update: null, autoUpdate: false }],
  ...over,
});

describe('parsing WPVulnerability answers', () => {
  it('keeps vulnerabilities with a usable range, an advisory title and the best https link', () => {
    const list = parseVulnResponse('plugin', ELEMENTOR)!;
    expect(list.map((v) => v.id)).toEqual([ELEMENTOR.data.vulnerability[0]!.uuid, ELEMENTOR.data.vulnerability[1]!.uuid, ELEMENTOR.data.vulnerability[3]!.uuid]);
    const [a, b, c] = list;
    expect(a).toMatchObject({ severity: 'medium', score: 4.3, fixedIn: '4.2.4', unfixed: false, cves: ['CVE-2026-11905'] });
    expect(a!.title).toMatch(/^Elementor Website Builder <= 4\.2\.3 - Missing Authorization/);
    expect(a!.link).toMatch(/^https:\/\/www\.wordfence\.com\//);
    // no advisory: the CVE text, without its language tag or markup; a <= bound gives no fix version
    expect(b).toMatchObject({ severity: 'critical', fixedIn: null, title: 'Remote Code Execution x' });
    expect(c!.link).toBeNull();
  });

  it('marks unfixed entries and reads core lists as affecting the version asked about', () => {
    expect(parseVulnResponse('theme', FLATSOME)![0]).toMatchObject({ unfixed: true, fixedIn: null, severity: 'high' });
    const core = parseVulnResponse('core', CORE)!;
    expect(core[0]).toMatchObject({ range: null, cves: ['CVE-2025-58674'], title: 'Stored XSS in the menu.' });
  });

  it('an unknown slug is "nothing known", a broken answer is a failed lookup', () => {
    expect(parseVulnResponse('plugin', UNKNOWN_SLUG)).toEqual([]);
    expect(parseVulnResponse('plugin', { error: 1, message: 'Nothing here' })).toBeNull();
    expect(parseVulnResponse('plugin', { error: 0, data: { vulnerability: 'x' } })).toBeNull();
    expect(parseVulnResponse('plugin', null)).toBeNull();
  });
});

describe('version ranges', () => {
  it('applies the min/max operators', () => {
    const lt = { min: null, max: { version: '4.2.4', op: 'lt' as const } };
    expect(affects(lt, '4.2.3')).toBe(true);
    expect(affects(lt, '4.2.4')).toBe(false);
    expect(affects(lt, '4.10')).toBe(false);
    const between = { min: { version: '3.6.0', op: 'ge' as const }, max: { version: '3.6.2', op: 'le' as const } };
    expect(['3.5.9', '3.6.0', '3.6.2', '3.6.3'].map((v) => affects(between, v))).toEqual([false, true, true, false]);
    expect(affects({ min: null, max: { version: '7.1.0', op: 'eq' } }, '7.1')).toBe(true);
    expect(affects({ min: { version: '2.0', op: 'gt' }, max: null }, '2.0')).toBe(false);
    // an unreadable installed version is never reported
    expect(affects(lt, '')).toBe(false);
    expect(affects(null, '6.4.1')).toBe(true);
  });
});

describe('matching an inventory', () => {
  const cache = new Map<string, Lookup>([
    ['core:6.4.1', { vulns: parseVulnResponse('core', CORE), fetchedAt: '2026-10-16T01:00:00.000Z' }],
    ['plugin:elementor', { vulns: parseVulnResponse('plugin', ELEMENTOR), fetchedAt: '2026-10-16T02:00:00.000Z' }],
    ['theme:flatsome', { vulns: parseVulnResponse('theme', FLATSOME), fetchedAt: '2026-10-16T03:00:00.000Z' }],
  ]);
  const lookup = (kind: string, key: string) => cache.get(`${kind}:${key}`);

  it('lists what affects the installed versions and counts missing lookups as unknown', () => {
    const v = matchInventory(inv(), lookup);
    expect(v.core).toHaveLength(1);
    expect(Object.keys(v.plugins)).toEqual(['elementor']);
    expect(v.plugins.elementor!.map((x) => x.fixedIn)).toEqual(['4.2.4']);
    expect(v.themes.flatsome![0]!.unfixed).toBe(true);
    expect(v.unknown).toBe(1); // "nope" was never looked up
    expect(v.checkedAt).toBe('2026-10-16T01:00:00.000Z');
    expect(wpVulnCount(v)).toEqual({ items: 3, worst: 'high' });
    expect(JSON.stringify(v)).not.toContain('range');
  });

  it('an updated plugin drops its fixed vulnerability', () => {
    const v = matchInventory(inv({ plugins: [{ slug: 'elementor', title: 'Elementor', status: 'active', version: '4.2.4', update: null, autoUpdate: false }] }), lookup);
    expect(v.plugins).toEqual({});
  });

  it('alerts on high/critical and unfixed findings, once each', () => {
    const items = alertItems(matchInventory(inv(), lookup));
    expect(items.map((i) => i.key)).toEqual([`theme:flatsome:${FLATSOME.data.vulnerability[0]!.uuid}`]);
    expect(freshAlerts(items, new Set(items.map((i) => i.key)))).toEqual([]);
  });

  it('looks up core per version and plugins/themes per slug, skipping unsafe names', () => {
    expect(lookupsFor(inv({ plugins: [{ slug: 'Akismet', title: '', status: 'active', version: '1', update: null, autoUpdate: false }, { slug: '../x', title: '', status: 'active', version: '1', update: null, autoUpdate: false }] }))).toEqual([
      ['core', '6.4.1'],
      ['plugin', 'akismet'],
      ['theme', 'flatsome'],
    ]);
  });
});

describe('lookup service', () => {
  const answers: Record<string, unknown> = {
    '/core/6.4.1/': CORE,
    '/plugin/elementor/': ELEMENTOR,
    '/plugin/nope/': UNKNOWN_SLUG,
    '/theme/flatsome/': FLATSOME,
  };

  it('caches lookups, retries failures later and honours the setting', async () => {
    db.prepare('DELETE FROM wp_vuln_cache').run();
    const before = getSecuritySettings();
    saveSecuritySettings({ ...before, vulnCheck: true });
    const asked: string[] = [];
    let down = true;
    setVulnFetch(async (url) => {
      const p = new URL(url).pathname;
      asked.push(p);
      if (down && p === '/theme/flatsome/') return { ok: false, status: 503, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify(answers[p] ?? UNKNOWN_SLUG) };
    });
    try {
      const now = Date.now();
      await refreshVulns(inv(), now);
      expect(asked.sort()).toEqual(['/core/6.4.1/', '/plugin/elementor/', '/plugin/nope/', '/theme/flatsome/']);
      let v = siteVulns(inv())!;
      expect(v.unknown).toBe(1); // flatsome failed
      expect(Object.keys(v.plugins)).toEqual(['elementor']);

      // fresh cache, failure not due yet: nothing asked again
      asked.length = 0;
      down = false;
      await refreshVulns(inv(), now + 60_000);
      expect(asked).toEqual([]);
      expect(hasDueLookups(inv(), now + 60_000)).toBe(false);

      // the failed lookup is retried after a few hours, the good ones after a day
      expect(hasDueLookups(inv(), now + 4 * 3_600_000)).toBe(true);
      await refreshVulns(inv(), now + 4 * 3_600_000);
      expect(asked).toEqual(['/theme/flatsome/']);
      v = siteVulns(inv())!;
      expect(v.unknown).toBe(0);
      expect(v.themes.flatsome).toHaveLength(1);

      saveSecuritySettings({ ...before, vulnCheck: false });
      expect(siteVulns(inv())).toBeNull();
      asked.length = 0;
      await refreshVulns(inv(), now + 48 * 3_600_000);
      expect(asked).toEqual([]);
    } finally {
      saveSecuritySettings(before);
      setVulnFetch((url, init) => fetch(url, init));
    }
  });

  it('a cached entry survives a JSON round trip', () => {
    const v = parseVulnResponse('plugin', ELEMENTOR)!;
    expect(JSON.parse(JSON.stringify(v)) as StoredVuln[]).toEqual(v);
  });
});
