import crypto from 'node:crypto';

export { parseGithubUrl, sameGithubRepo } from '@lares/shared';

/**
 * GitHub App rules (pure, no I/O): the registration manifest, the App's JWT and GitHub URLs.
 *
 * The App only asks for read access to code (contents) and repo metadata, and has no webhook:
 * it can clone and list repos, nothing else. Installation tokens are requested per repo at clone
 * time and expire after an hour, so nothing long-lived is ever handed to git.
 */

export const GITHUB = 'https://github.com';

/** App names are global on GitHub and at most 34 characters: the panel host plus a random suffix. */
export function appName(host: string, suffix: string): string {
  const base = `Lares ${host.replace(/:\d+$/, '')}`.slice(0, 34 - suffix.length - 1).trim();
  return `${base} ${suffix}`;
}

export function buildManifest(origin: string, name: string) {
  return {
    name,
    url: 'https://lares.thocode.dev',
    description: 'Lares Panel: clone and deploy repositories on this server.',
    // GitHub sends the admin back to this SPA route with ?code=&state= after "Create GitHub App".
    redirect_url: `${origin}/settings/github/callback`,
    // ...and here after the App is installed on an account or its repo access changes.
    setup_url: `${origin}/settings?tab=integrations&github=installed`,
    setup_on_update: true,
    public: false,
    default_permissions: { contents: 'read', metadata: 'read' },
    default_events: [] as string[],
  };
}

/** Where the browser posts the manifest: the admin's account, or an organization they manage. */
export function manifestActionUrl(state: string, org?: string): string {
  const base = org ? `${GITHUB}/organizations/${encodeURIComponent(org)}/settings/apps/new` : `${GITHUB}/settings/apps/new`;
  return `${base}?state=${encodeURIComponent(state)}`;
}

export const installUrl = (slug: string) => `${GITHUB}/apps/${encodeURIComponent(slug)}/installations/new`;

export function appSettingsUrl(slug: string, owner: string, ownerType: string): string {
  return ownerType === 'Organization'
    ? `${GITHUB}/organizations/${encodeURIComponent(owner)}/settings/apps/${encodeURIComponent(slug)}`
    : `${GITHUB}/settings/apps/${encodeURIComponent(slug)}`;
}

export function installationSettingsUrl(id: number, account: string, accountType: string): string {
  return accountType === 'Organization'
    ? `${GITHUB}/organizations/${encodeURIComponent(account)}/settings/installations/${id}`
    : `${GITHUB}/settings/installations/${id}`;
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/**
 * RS256 JWT that authenticates as the App itself (listing installations, minting installation
 * tokens). Backdated 60 s against clock drift; GitHub rejects anything valid for over 10 minutes.
 */
export function appJwt(appId: number, privateKeyPem: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 9 * 60, iss: appId }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKeyPem);
  return `${header}.${payload}.${b64url(signature)}`;
}
