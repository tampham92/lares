import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudflareZone, DnsRecordBrief } from '@lares/shared';
import { cloudflareTokenSchema, serverIpSchema } from '@lares/shared';
import { getSetting, setSetting } from '../src/db/index.js';
import { runWithLang } from '../src/i18n/index.js';
import {
  applyDnsRecords,
  cloudflareError,
  collectOut,
  connectCloudflare,
  disconnectCloudflare,
  ensurePanelRecord,
  getCloudflareDnsView,
  isCloudflareIp,
  matchZone,
  planDns,
  planRecords,
  refreshCloudflare,
  setProxied,
  tokenHint,
  type Ownership,
} from '../src/services/cloudflareDns.js';
import { ipInCidr, isPublicIp, pickIpv6, sameIp, saveServerIp } from '../src/services/publicIp.js';

const TOKEN = 'cfTOKEN_abcdefghijklmnopqrstuvwxyz0123456789';
const SERVER_V4 = '45.76.10.20';
const SERVER_V6 = '2a01:4f8:1c1c::10';
const hex = (n: number) => n.toString(16).padStart(32, '0');
const zone = (n: number, name: string, status = 'active'): CloudflareZone => ({ id: hex(n), name, status });
const rec = (id: string, type: DnsRecordBrief['type'], content: string, proxied = false): DnsRecordBrief => ({ id, type, content, proxied });
const NOBODY: Ownership = { managed: new Set(), addresses: [] };

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

describe('zone matching', () => {
  const zones = [zone(1, 'example.com'), zone(2, 'example.com.vn'), zone(3, 'shop.example.com'), zone(4, 'thocode.dev')];

  it('matches the apex and subdomains', () => {
    expect(matchZone('example.com', zones)?.name).toBe('example.com');
    expect(matchZone('www.example.com', zones)?.name).toBe('example.com');
    expect(matchZone('a.b.c.thocode.dev', zones)?.name).toBe('thocode.dev');
  });

  it('handles multi-level public suffixes', () => {
    expect(matchZone('shop.example.com.vn', zones)?.name).toBe('example.com.vn');
    expect(matchZone('example.com.vn', zones)?.name).toBe('example.com.vn');
    expect(matchZone('other.com.vn', zones)).toBeNull();
  });

  it('prefers the most specific zone (delegated subdomain zone)', () => {
    expect(matchZone('www.shop.example.com', zones)?.id).toBe(hex(3));
    expect(matchZone('shop.example.com', zones)?.id).toBe(hex(3));
  });

  it('never matches on a bare suffix', () => {
    expect(matchZone('notexample.com', zones)).toBeNull();
    expect(matchZone('example.co', zones)).toBeNull();
    expect(matchZone('thocode.dev.evil.com', zones)).toBeNull();
  });

  it('ignores case and a trailing dot', () => {
    expect(matchZone('WWW.Example.COM.', zones)?.name).toBe('example.com');
  });
});

describe('record planning', () => {
  const want = { ipv4: SERVER_V4, ipv6: null };

  it('creates when nothing exists', () => {
    expect(planRecords([], want, NOBODY)).toEqual([
      { type: 'A', content: SERVER_V4, action: 'create', existing: [] },
      { type: 'AAAA', content: null, action: 'none', existing: [] },
    ]);
  });

  it('creates AAAA too when an IPv6 is known', () => {
    const p = planRecords([], { ipv4: SERVER_V4, ipv6: SERVER_V6 }, NOBODY);
    expect(p.map((x) => [x.type, x.action, x.content])).toEqual([
      ['A', 'create', SERVER_V4],
      ['AAAA', 'create', SERVER_V6],
    ]);
  });

  it('is ok when the record already points here (any IPv6 notation)', () => {
    const p = planRecords([rec(hex(10), 'A', SERVER_V4, true), rec(hex(11), 'AAAA', '2a01:04f8:1c1c:0:0:0:0:10')], { ipv4: SERVER_V4, ipv6: SERVER_V6 }, NOBODY);
    expect(p.map((x) => x.action)).toEqual(['ok', 'ok']);
  });

  it('flags a record pointing elsewhere as a conflict', () => {
    const p = planRecords([rec(hex(10), 'A', '93.184.216.34')], want, NOBODY);
    expect(p[0]).toMatchObject({ action: 'conflict', existing: [{ content: '93.184.216.34' }] });
  });

  it('flags round-robin records that include another server', () => {
    const p = planRecords([rec(hex(10), 'A', SERVER_V4), rec(hex(11), 'A', '93.184.216.34')], want, NOBODY);
    expect(p[0]!.action).toBe('conflict');
  });

  it('updates records Lares created, or that hold one of this server\'s addresses', () => {
    const old = rec(hex(10), 'A', '45.76.10.99');
    expect(planRecords([old], want, { managed: new Set([hex(10)]), addresses: [] })[0]!.action).toBe('update');
    expect(planRecords([old], want, { managed: new Set(), addresses: ['45.76.10.99'] })[0]!.action).toBe('update');
  });

  it('treats a CNAME as a conflict, reported once', () => {
    const p = planRecords([rec(hex(12), 'CNAME', 'example.netlify.app')], { ipv4: SERVER_V4, ipv6: SERVER_V6 }, NOBODY);
    expect(p[0]).toMatchObject({ action: 'conflict', existing: [{ type: 'CNAME' }] });
    expect(p[1]).toMatchObject({ action: 'create', existing: [] });
  });

  it('an AAAA without a server IPv6: foreign = conflict, created by Lares = delete, the admin\'s own for this server = left alone', () => {
    const aaaa = rec(hex(13), 'AAAA', '2001:4860::1');
    expect(planRecords([aaaa], want, NOBODY)[1]!.action).toBe('conflict');
    expect(planRecords([aaaa], want, { managed: new Set([hex(13)]), addresses: [] })[1]).toMatchObject({ action: 'delete', existing: [aaaa] });
    expect(planRecords([aaaa], want, { managed: new Set(), addresses: ['2001:4860::1'] })[1]!.action).toBe('ok');
  });
});

describe('address helpers', () => {
  it('checks CIDR membership for both families', () => {
    expect(ipInCidr('104.16.1.1', '104.16.0.0/13')).toBe(true);
    expect(ipInCidr('104.24.0.1', '104.16.0.0/13')).toBe(false);
    expect(ipInCidr('2606:4700::1111', '2606:4700::/32')).toBe(true);
    expect(ipInCidr('2606:4701::1', '2606:4700::/32')).toBe(false);
    expect(ipInCidr('1.2.3.4', '2606:4700::/32')).toBe(false);
    expect(ipInCidr('1.2.3.4', '1.2.3.4')).toBe(true);
  });

  it('knows public from private addresses', () => {
    expect(isPublicIp(SERVER_V4)).toBe(true);
    expect(isPublicIp(SERVER_V6)).toBe(true);
    for (const ip of ['10.0.0.1', '172.20.1.1', '192.168.1.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', 'fe80::1', 'fd00::1', '::1', '2001:db8::1', 'nope']) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  it('compares addresses across notations', () => {
    expect(sameIp('2a01:4f8:1c1c::10', '2A01:04F8:1C1C:0000:0000:0000:0000:0010')).toBe(true);
    expect(sameIp('::ffff:1.2.3.4', '::ffff:102:304')).toBe(true);
    expect(sameIp('1.2.3.4', '1.2.3.5')).toBe(false);
  });

  it('recognises Cloudflare edge addresses', () => {
    expect(isCloudflareIp('104.21.32.1')).toBe(true);
    expect(isCloudflareIp('2606:4700:3030::6815:2001')).toBe(true);
    expect(isCloudflareIp(SERVER_V4)).toBe(false);
  });

  it('validates the override form', () => {
    expect(serverIpSchema.parse({ ipv4: '', ipv6: '' })).toEqual({ ipv4: null, ipv6: null, ipv6Disabled: false });
    expect(serverIpSchema.safeParse({ ipv4: '1.2.3' }).success).toBe(false);
    expect(serverIpSchema.safeParse({ ipv6: SERVER_V4 }).success).toBe(false);
    expect(() => saveServerIp({ ipv4: '192.168.1.10', ipv6: null, ipv6Disabled: false })).toThrow(/192\.168\.1\.10/);
  });

  it('rejects tokens with spaces or that are too short', () => {
    expect(cloudflareTokenSchema.safeParse({ token: 'abc' }).success).toBe(false);
    expect(cloudflareTokenSchema.safeParse({ token: 'abcdefghij klmnopqrstuvwxyz' }).success).toBe(false);
    expect(cloudflareTokenSchema.parse({ token: `  ${TOKEN}\n` }).token).toBe(TOKEN);
  });
});

// ---------------------------------------------------------------------------------------------
// API client against a fake Cloudflare
// ---------------------------------------------------------------------------------------------

interface FakeRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  comment?: string;
}

interface Call {
  method: string;
  url: string;
  auth: string | null;
  body: Record<string, unknown> | null;
}

function fakeCloudflare(opts: { zones?: CloudflareZone[]; records?: FakeRecord[]; token?: string; verify?: 'ok' | 'invalid' | 'disabled'; sslMode?: string } = {}) {
  const zones = opts.zones ?? [zone(1, 'thocode.dev'), zone(2, 'example.com.vn')];
  const records = opts.records ?? [];
  const calls: Call[] = [];
  let next = 100;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const ok = (result: unknown, extra: Record<string, unknown> = {}) => json(200, { success: true, errors: [], messages: [], result, ...extra });
  const fail = (status: number, code: number, message: string) => json(status, { success: false, errors: [{ code, message }], messages: [], result: null });

  const handler = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, url: url.toString(), auth: headers.get('authorization'), body });
    if (url.hostname !== 'api.cloudflare.com') return new Response('not found', { status: 404 }); // IP echo services
    if (headers.get('authorization') !== `Bearer ${opts.token ?? TOKEN}`) return fail(401, 1000, 'Invalid API Token');
    const path = url.pathname.replace('/client/v4', '');
    if (path === '/user/tokens/verify') {
      if (opts.verify === 'invalid') return fail(401, 1000, 'Invalid API Token');
      return ok({ id: 'x', status: opts.verify === 'disabled' ? 'disabled' : 'active' });
    }
    if (path === '/zones') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const per = Number(url.searchParams.get('per_page') ?? 20);
      const list = zones.slice((page - 1) * per, page * per).map((z) => ({ ...z, account: { id: 'acc', name: 'ThoCode' } }));
      return ok(list, { result_info: { page, per_page: per, total_pages: Math.max(1, Math.ceil(zones.length / per)) } });
    }
    const m = /^\/zones\/([0-9a-f]{32})\/(dns_records|settings\/ssl)(?:\/([0-9a-f]{32}))?$/.exec(path);
    const z = m && zones.find((x) => x.id === m[1]);
    if (!m || !z) return fail(404, 7003, 'Could not route');
    if (m[2] === 'settings/ssl') return opts.sslMode ? ok({ id: 'ssl', value: opts.sslMode }) : fail(403, 10000, 'Authentication error');
    if (method === 'GET') {
      const name = url.searchParams.get('name');
      return ok(records.filter((r) => !name || r.name === name));
    }
    if (method === 'POST') {
      if (records.some((r) => r.name === body!.name && (r.type === 'CNAME' || body!.type === 'CNAME'))) return fail(400, 81053, 'A CNAME record with that host already exists.');
      const r: FakeRecord = { id: hex(next++), type: String(body!.type), name: String(body!.name), content: String(body!.content), proxied: body!.proxied === true, comment: body!.comment as string };
      records.push(r);
      return ok(r);
    }
    const idx = records.findIndex((r) => r.id === m[3]);
    if (idx < 0) return fail(404, 81044, 'Record does not exist.');
    if (method === 'PATCH') {
      Object.assign(records[idx]!, body);
      return ok(records[idx]);
    }
    if (method === 'DELETE') {
      records.splice(idx, 1);
      return ok({ id: m[3] });
    }
    return fail(405, 0, 'method');
  };
  const fetchMock = vi.fn(handler);
  vi.stubGlobal('fetch', fetchMock);
  return { calls, records, fetchMock };
}

/** Everything the panel stores, returns or logs, as one string. */
const everything = (...extra: unknown[]) => JSON.stringify([getSetting('cloudflareDns', null), getCloudflareDnsView(), ...extra]);

beforeEach(() => {
  setSetting('cloudflareDns', {});
  // fixed addresses, detection considered fresh
  setSetting('serverPublicIp', { ipv4Override: SERVER_V4, ipv6Override: null, ipv6Disabled: true, detected: { ipv4: null, ipv6: null, at: new Date().toISOString() } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Cloudflare token', () => {
  it('connects: verifies, lists every zone page, checks DNS read access', async () => {
    const many = Array.from({ length: 60 }, (_, i) => zone(i + 1, `site${i}.example`));
    const cf = fakeCloudflare({ zones: many });
    const view = await connectCloudflare(TOKEN);
    expect(view).toMatchObject({ connected: true, accountName: 'ThoCode', tokenHint: 'cfTO…6789', lastError: null });
    expect(view.zones).toHaveLength(60);
    expect(cf.calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/client/v4/user/tokens/verify',
      '/client/v4/zones',
      '/client/v4/zones',
      `/client/v4/zones/${hex(1)}/dns_records`,
    ]);
    expect(cf.calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it('never stores or returns the token in clear', async () => {
    fakeCloudflare();
    await connectCloudflare(TOKEN);
    const stored = getSetting<{ tokenEnc: string; verifiedAt: string }>('cloudflareDns', { tokenEnc: '', verifiedAt: '' });
    expect(stored.tokenEnc).toBeTruthy();
    expect(stored.verifiedAt).toBeTruthy();
    expect(everything()).not.toContain(TOKEN);
    expect(everything()).not.toContain(TOKEN.slice(4, -4));
    expect(Object.keys(getCloudflareDnsView())).not.toContain('tokenEnc');
    expect(tokenHint('short')).toBe('••••');
  });

  it('rejects an invalid token with a readable error and stores nothing', async () => {
    fakeCloudflare({ token: 'another-token-entirely-0000000000' });
    const err = await connectCloudflare(TOKEN).catch((e: Error & { statusCode?: number }) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { statusCode?: number }).statusCode).toBe(400); // never 401: the web UI would log the admin out
    expect((err as Error).message).toContain('Invalid API Token');
    expect((err as Error).message).not.toContain(TOKEN);
    expect(getCloudflareDnsView().connected).toBe(false);
  });

  it('reports a disabled token', async () => {
    fakeCloudflare({ verify: 'disabled' });
    await expect(connectCloudflare(TOKEN)).rejects.toThrow(/disabled/);
  });

  it('accepts account-owned tokens (user-level verify fails, zones work)', async () => {
    fakeCloudflare({ verify: 'invalid' });
    expect((await connectCloudflare(TOKEN)).connected).toBe(true);
  });

  it('refuses a token without zones', async () => {
    fakeCloudflare({ zones: [] });
    await expect(connectCloudflare(TOKEN)).rejects.toThrow(/Zone Resources/);
  });

  it('translates API errors', () => {
    runWithLang('en', () => {
      expect(cloudflareError(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }], result: null }).message).toMatch(/Zone → DNS → Edit/);
      expect(cloudflareError(429, null).statusCode).toBe(429);
      expect(cloudflareError(500, null).message).toBe('Cloudflare returned an error 500: HTTP 500');
      expect(cloudflareError(400, { success: false, errors: [{ code: 6003, message: 'Invalid request headers' }], result: null }).message).toMatch(/rejected the API token/);
    });
  });

  it('handles network failures and timeouts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.cloudflare.com') });
    }));
    await expect(connectCloudflare(TOKEN)).rejects.toThrow(/ENOTFOUND/);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }));
    await expect(connectCloudflare(TOKEN)).rejects.toMatchObject({ statusCode: 504 });
  });

  it('keeps the connection but records the error when a refresh fails, and disconnects', async () => {
    const cf = fakeCloudflare();
    await connectCloudflare(TOKEN);
    cf.fetchMock.mockImplementation(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(refreshCloudflare()).rejects.toThrow(/502/);
    expect(getCloudflareDnsView()).toMatchObject({ connected: true, lastError: expect.stringContaining('502') });
    expect(disconnectCloudflare()).toMatchObject({ connected: false, tokenHint: null, zones: [] });
    expect(getSetting<{ tokenEnc: unknown }>('cloudflareDns', { tokenEnc: 'x' }).tokenEnc).toBeNull();
  });
});

describe('Cloudflare records', () => {
  const connect = async (records: FakeRecord[] = [], extra: Parameters<typeof fakeCloudflare>[0] = {}) => {
    const cf = fakeCloudflare({ records, ...extra });
    await connectCloudflare(TOKEN);
    cf.calls.length = 0;
    return cf;
  };

  it('creates missing records as DNS only and never touches a foreign one without consent', async () => {
    const cf = await connect([{ id: hex(50), type: 'A', name: 'www.shop.example.com.vn', content: '93.184.216.34', proxied: true }]);
    const { out, result } = collectOut();
    await applyDnsRecords(['shop.example.com.vn', 'www.shop.example.com.vn', 'other.org'], { overwrite: [] }, out);

    const created = cf.records.find((r) => r.name === 'shop.example.com.vn');
    expect(created).toMatchObject({ type: 'A', content: SERVER_V4, proxied: false, comment: 'Lares Panel' });
    expect(cf.records.find((r) => r.id === hex(50))).toMatchObject({ content: '93.184.216.34', proxied: true });
    expect(cf.calls.filter((c) => c.method !== 'GET')).toHaveLength(1);
    expect(result.messages.map((m) => m.level)).toEqual(['info', 'warn', 'warn']);
    expect(result.messages[1]!.text).toContain('93.184.216.34');
    expect(result.messages[2]!.text).toContain('other.org');
    expect(getSetting<{ managed: string[] }>('cloudflareDns', { managed: [] }).managed).toContain(created!.id);
    expect(everything(result)).not.toContain(TOKEN);
  });

  it('leaves a conflicting hostname completely alone (no AAAA here while the A points elsewhere)', async () => {
    saveServerIp({ ipv4: SERVER_V4, ipv6: SERVER_V6, ipv6Disabled: false });
    const cf = await connect([{ id: hex(50), type: 'A', name: 'www.thocode.dev', content: '93.184.216.34', proxied: false }]);
    const { out, result } = collectOut();
    await applyDnsRecords(['www.thocode.dev'], { overwrite: [] }, out);
    expect(cf.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(result.messages).toEqual([{ level: 'warn', text: expect.stringContaining('A 93.184.216.34') }]);
  });

  it('overwrites a conflict only for the confirmed hostname, DNS only, removing a CNAME first', async () => {
    const cf = await connect([
      { id: hex(50), type: 'A', name: 'www.thocode.dev', content: '93.184.216.34', proxied: true },
      { id: hex(51), type: 'CNAME', name: 'blog.thocode.dev', content: 'ghs.example.net', proxied: false },
    ]);
    const { out, result } = collectOut();
    await applyDnsRecords(['www.thocode.dev', 'blog.thocode.dev'], { overwrite: ['www.thocode.dev', 'blog.thocode.dev'] }, out);
    expect(cf.records.find((r) => r.id === hex(50))).toMatchObject({ content: SERVER_V4, proxied: false });
    expect(cf.records.some((r) => r.type === 'CNAME')).toBe(false);
    expect(cf.records.find((r) => r.name === 'blog.thocode.dev')).toMatchObject({ type: 'A', content: SERVER_V4 });
    const writes = cf.calls.filter((c) => c.method !== 'GET').map((c) => c.method);
    expect(writes).toEqual(['PATCH', 'DELETE', 'POST']);
    expect(result.messages.every((m) => m.level === 'info')).toBe(true);
  });

  it('updates its own record silently and keeps its proxy setting', async () => {
    const cf = await connect([{ id: hex(60), type: 'A', name: 'thocode.dev', content: '45.76.10.99', proxied: true }]);
    setSetting('cloudflareDns', { ...getSetting<object>('cloudflareDns', {}), managed: [hex(60)] });
    const { out, result } = collectOut();
    await applyDnsRecords(['thocode.dev'], { overwrite: [] }, out);
    expect(cf.records[0]).toMatchObject({ content: SERVER_V4, proxied: true });
    expect(result.messages[0]!.text).toContain('45.76.10.99');
  });

  it('adds AAAA when an IPv6 is configured and reports existing records as ok', async () => {
    saveServerIp({ ipv4: SERVER_V4, ipv6: SERVER_V6, ipv6Disabled: false });
    const cf = await connect([{ id: hex(70), type: 'A', name: 'thocode.dev', content: SERVER_V4, proxied: false }]);
    const { out } = collectOut();
    await applyDnsRecords(['thocode.dev'], { overwrite: [] }, out);
    expect(cf.records.map((r) => `${r.type} ${r.content}`).sort()).toEqual([`A ${SERVER_V4}`, `AAAA ${SERVER_V6}`]);
  });

  it('panel hostname: DNS only and A only', async () => {
    saveServerIp({ ipv4: SERVER_V4, ipv6: SERVER_V6, ipv6Disabled: false });
    const cf = await connect([{ id: hex(80), type: 'A', name: 'panel.thocode.dev', content: SERVER_V4, proxied: true }]);
    await ensurePanelRecord('panel.thocode.dev', false, collectOut().out);
    expect(cf.records).toHaveLength(1);
    expect(cf.records[0]!.proxied).toBe(false);
    expect((await planDns(['panel.thocode.dev'], { ipv4Only: true })).hostnames[0]!.plan.map((p) => p.action)).toEqual(['ok', 'none']);
  });

  it('previews the plan per hostname', async () => {
    await connect([{ id: hex(50), type: 'A', name: 'www.thocode.dev', content: '93.184.216.34', proxied: false }]);
    const r = await planDns(['thocode.dev', 'www.thocode.dev', 'other.org']);
    expect(r.connected).toBe(true);
    expect(r.hostnames.map((h) => [h.hostname, h.zone?.name ?? null, h.plan[0]?.action ?? null])).toEqual([
      ['thocode.dev', 'thocode.dev', 'create'],
      ['www.thocode.dev', 'thocode.dev', 'conflict'],
      ['other.org', null, null],
    ]);
  });

  it('switches the proxy only on records pointing here and warns about a Flexible SSL mode', async () => {
    const cf = await connect(
      [
        { id: hex(90), type: 'A', name: 'thocode.dev', content: SERVER_V4, proxied: false },
        { id: hex(91), type: 'A', name: 'www.thocode.dev', content: '93.184.216.34', proxied: false },
      ],
      { sslMode: 'flexible' },
    );
    const { out, result } = collectOut();
    await setProxied(['thocode.dev', 'www.thocode.dev'], true, out);
    expect(cf.records.find((r) => r.id === hex(90))!.proxied).toBe(true);
    expect(cf.records.find((r) => r.id === hex(91))!.proxied).toBe(false);
    expect(result.messages.filter((m) => m.level === 'warn').map((m) => m.text).join('\n')).toMatch(/flexible[\s\S]*www\.thocode\.dev/);
  });

  it('refuses to work without a token or a server IP', async () => {
    await expect(applyDnsRecords(['thocode.dev'], { overwrite: [] }, collectOut().out)).rejects.toThrow(/Cloudflare/);
    await connect();
    setSetting('serverPublicIp', { ipv4Override: null, ipv6Override: null, ipv6Disabled: true, detected: { ipv4: null, ipv6: null, at: new Date().toISOString() } });
    await expect(applyDnsRecords(['thocode.dev'], { overwrite: [] }, collectOut().out)).rejects.toThrow(/IP/);
  });
});

describe('pickIpv6', () => {
  const iface = '2a01:4f8::1';
  it('uses the address the Internet sees', () => expect(pickIpv6('1.2.3.4', '2a01:4f8::2', iface)).toBe('2a01:4f8::2'));
  it('drops IPv6 when only IPv4 reaches the Internet (an address without a route)', () => expect(pickIpv6('1.2.3.4', null, iface)).toBeNull());
  it('falls back to the interface when no echo service answered at all', () => expect(pickIpv6(null, null, iface)).toBe(iface));
});
