import crypto from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { githubManifestSchema } from '@lares/shared';
import { getSetting } from '../src/db/index.js';
import { cloneTokenFor, completeManifest, disconnectGithub, getGithubView, startManifest } from '../src/services/githubApp.js';
import { appJwt, appName, buildManifest, manifestActionUrl, parseGithubUrl, sameGithubRepo } from '../src/services/githubAppRules.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

describe('GitHub App rules', () => {
  it('keeps App names within GitHub limits', () => {
    const name = appName('a-very-long-panel-hostname.example.com:8443', 'ab12');
    expect(name.length).toBeLessThanOrEqual(34);
    expect(name.endsWith(' ab12')).toBe(true);
    expect(name).not.toContain('8443');
  });

  it('asks only for read access and sends the admin back to the panel', () => {
    const m = buildManifest('https://panel.example.com:8443', 'Lares x');
    expect(m.default_permissions).toEqual({ contents: 'read', metadata: 'read' });
    expect(m.default_events).toEqual([]);
    expect(m).not.toHaveProperty('hook_attributes');
    expect(m.public).toBe(false);
    expect(m.redirect_url).toBe('https://panel.example.com:8443/settings/github/callback');
  });

  it('creates the App on the personal account or an organization', () => {
    expect(manifestActionUrl('s1')).toBe('https://github.com/settings/apps/new?state=s1');
    expect(manifestActionUrl('s1', 'acme')).toBe('https://github.com/organizations/acme/settings/apps/new?state=s1');
  });

  it('signs a short-lived RS256 JWT for the App', () => {
    const jwt = appJwt(42, PEM, 1_000_000);
    const [h, p, s] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ iat: 999_940, exp: 1_000_540, iss: 42 });
    expect(crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('recognises github.com repo URLs only', () => {
    expect(parseGithubUrl('https://github.com/tampham92/site.git')).toEqual({ owner: 'tampham92', repo: 'site' });
    expect(parseGithubUrl('https://github.com/tampham92/site')).toEqual({ owner: 'tampham92', repo: 'site' });
    expect(parseGithubUrl('https://gitlab.com/a/b.git')).toBeNull();
    expect(parseGithubUrl('git@github.com:a/b.git')).toBeNull();
    expect(sameGithubRepo('https://github.com/A/B.git', 'https://github.com/a/b')).toBe(true);
  });

  it('accepts only a bare panel origin', () => {
    expect(githubManifestSchema.parse({ origin: 'https://1.2.3.4:8443/' }).origin).toBe('https://1.2.3.4:8443');
    expect(githubManifestSchema.safeParse({ origin: 'https://x.com/evil?y' }).success).toBe(false);
    expect(githubManifestSchema.safeParse({ origin: 'javascript:alert(1)' }).success).toBe(false);
  });
});

type Call = { url: string; method: string; auth: string | undefined; body: unknown };

function stubGithub(routes: Record<string, (c: Call) => [number, unknown]>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    const call = { url, method: init.method ?? 'GET', auth: headers.authorization, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const key = `${call.method} ${url.replace('https://api.github.com', '')}`;
    const route = Object.entries(routes).find(([k]) => key.startsWith(k));
    const [status, body] = route ? route[1](call) : [404, { message: 'Not Found' }];
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

describe('GitHub App connection', () => {
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => disconnectGithub());

  it('refuses a code that this panel did not ask for', async () => {
    await expect(completeManifest('abc', 'f'.repeat(32))).rejects.toThrow();
  });

  it('stores the App with its key encrypted, then mints repo-scoped clone tokens', async () => {
    const start = startManifest('https://panel.example.com', undefined);
    const state = new URL(start.action).searchParams.get('state')!;
    stubGithub({
      'POST /app-manifests/the-code/conversions': () => [201, { id: 7, slug: 'lares-x', name: 'Lares x', html_url: 'https://github.com/apps/lares-x', pem: PEM, owner: { login: 'tampham92', type: 'User' } }],
      'GET /app/installations': () => [200, [{ id: 99, account: { login: 'tampham92', type: 'User' }, repository_selection: 'selected' }]],
    });
    const view = await completeManifest('the-code', state);
    expect(view.connected).toBe(true);
    expect(view.installations).toEqual([expect.objectContaining({ id: 99, account: 'tampham92' })]);
    expect(JSON.stringify(getSetting('githubApp', null))).not.toContain('PRIVATE KEY');
    // the state is single-use
    await expect(completeManifest('the-code', state)).rejects.toThrow();

    const calls = stubGithub({
      'GET /repos/tampham92/site/installation': () => [200, { id: 99 }],
      'POST /app/installations/99/access_tokens': () => [201, { token: 'ghs_short_lived' }],
    });
    expect(await cloneTokenFor('https://github.com/tampham92/site.git')).toBe('ghs_short_lived');
    const mint = calls.find((c) => c.url.endsWith('/access_tokens'))!;
    expect(mint.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(mint.body).toEqual({ repositories: ['site'], permissions: { contents: 'read', metadata: 'read' } });

    // a repo the App cannot see (public, or not granted) clones without a token
    stubGithub({});
    expect(await cloneTokenFor('https://github.com/someone/else.git')).toBeNull();
    expect(await cloneTokenFor('https://gitlab.com/a/b.git')).toBeNull();
  });

  it('reports an App deleted on GitHub without logging the admin out', async () => {
    stubGithub({ 'GET /app/installations': () => [401, { message: 'Bad credentials' }] });
    const view = await getGithubView();
    expect(view.connected).toBe(true);
    expect(view.lastError).toMatch(/GitHub/);
  });
});
