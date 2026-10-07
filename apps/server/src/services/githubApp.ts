import crypto from 'node:crypto';
import type { GithubAppView, GithubInstallation, GithubManifestStart, GithubRepo } from '@lares/shared';
import { getSetting, setSetting } from '../db/index.js';
import { t } from '../i18n/index.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { HttpError, badRequest, conflict, errorMessage } from '../lib/errors.js';
import { appJwt, appName, appSettingsUrl, buildManifest, installUrl, installationSettingsUrl, manifestActionUrl, parseGithubUrl } from './githubAppRules.js';

/**
 * GitHub App connection: the admin creates an App owned by their own GitHub account from a
 * manifest (two clicks), installs it on the repos they choose, then picks a repo when creating a
 * Next.js site. Its private key is stored encrypted under the settings key `githubApp` and never
 * leaves the server; git only ever sees one-hour installation tokens scoped to a single repo.
 */
const SETTING = 'githubApp';
const API = 'https://api.github.com';
const TIMEOUT_MS = 15_000;
const STATE_TTL_MS = 60 * 60_000;
const MAX_PAGES = 10;

interface Stored {
  appId: number;
  slug: string;
  name: string;
  owner: string;
  ownerType: string;
  htmlUrl: string;
  pemEnc: string;
  createdAt: string;
}

const stored = (): Stored | null => getSetting<Stored | null>(SETTING, null);

/** Manifest flows started from this panel, by state; GitHub hands the state back with the code. */
const pending = new Map<string, number>();

type Auth = { jwt: true } | { token: string } | null;

/** Translated error for a failed call. Never 401: the panel would treat it as its own session expiring. */
function githubError(status: number, body: { message?: string } | null, auth: Auth): HttpError {
  const detail = (body?.message ?? `HTTP ${status}`).slice(0, 300);
  if (status === 401 && auth && 'jwt' in auth) {
    return badRequest(t('GitHub không nhận App này nữa (có thể App đã bị xoá trên GitHub). Hãy ngắt kết nối rồi kết nối lại.'));
  }
  if (status === 403 && /rate limit/i.test(detail)) return new HttpError(429, t('GitHub đang giới hạn số lượng yêu cầu, thử lại sau ít phút'));
  return badRequest(t('GitHub báo lỗi {status}: {detail}', { status, detail }));
}

async function gh<T>(method: 'GET' | 'POST', path: string, auth: Auth, body?: unknown): Promise<{ status: number; data: T | null }> {
  const app = stored();
  const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'Lares-Panel' };
  if (auth && 'jwt' in auth) {
    if (!app) throw conflict(t('Chưa kết nối GitHub'));
    headers.authorization = `Bearer ${appJwt(app.appId, decrypt<string>(app.pemEnc))}`;
  } else if (auth) {
    headers.authorization = `Bearer ${auth.token}`;
  }
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new HttpError(504, t('Hết thời gian chờ khi gọi API GitHub'));
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : errorMessage(err);
    throw new HttpError(502, t('Không kết nối được API GitHub: {error}', { error: cause }));
  }
  const text = await res.text().catch(() => '');
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    /* an HTML error page from a proxy */
  }
  if (res.ok || res.status === 404) return { status: res.status, data };
  throw githubError(res.status, data as { message?: string } | null, auth);
}

// ---- Connecting ---------------------------------------------------------------------

export function startManifest(origin: string, org?: string): GithubManifestStart {
  if (stored()) throw conflict(t('Đã kết nối GitHub. Ngắt kết nối trước khi tạo App mới.'));
  const now = Date.now();
  for (const [s, at] of pending) if (now - at > STATE_TTL_MS) pending.delete(s);
  const state = crypto.randomBytes(16).toString('hex');
  pending.set(state, now);
  const manifest = buildManifest(origin, appName(new URL(origin).host, crypto.randomBytes(2).toString('hex')));
  return { action: manifestActionUrl(state, org), manifest: JSON.stringify(manifest) };
}

/** Exchange the one-time code GitHub sent back for the App's id and private key. */
export async function completeManifest(code: string, state: string): Promise<GithubAppView> {
  const at = pending.get(state);
  // The state proves this panel started the flow, so a link cannot attach someone else's App.
  if (!at || Date.now() - at > STATE_TTL_MS) throw badRequest(t('Phiên tạo GitHub App đã hết hạn hoặc không hợp lệ. Hãy bấm "Kết nối GitHub" lại.'));
  pending.delete(state);
  const r = await gh<{ id: number; slug: string; name: string; html_url: string; pem: string; owner?: { login?: string; type?: string } }>(
    'POST',
    `/app-manifests/${encodeURIComponent(code)}/conversions`,
    null,
  );
  const app = r.data;
  if (r.status === 404 || !app?.id || !app.pem || !app.slug) throw badRequest(t('Mã xác nhận GitHub đã hết hạn hoặc đã được dùng. Hãy bấm "Kết nối GitHub" lại.'));
  setSetting(SETTING, {
    appId: app.id,
    slug: app.slug,
    name: app.name,
    owner: app.owner?.login ?? '',
    ownerType: app.owner?.type ?? 'User',
    htmlUrl: app.html_url,
    pemEnc: encrypt(app.pem),
    createdAt: new Date().toISOString(),
  } satisfies Stored);
  return getGithubView();
}

export async function disconnectGithub(): Promise<GithubAppView> {
  setSetting(SETTING, null);
  return getGithubView();
}

// ---- Reading ------------------------------------------------------------------------

type RawInstallation = { id: number; account?: { login?: string; type?: string }; repository_selection?: string };

async function installations(): Promise<GithubInstallation[]> {
  const out: GithubInstallation[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await gh<RawInstallation[]>('GET', `/app/installations?per_page=100&page=${page}`, { jwt: true });
    for (const i of r.data ?? []) {
      const account = i.account?.login ?? '?';
      const accountType = i.account?.type ?? 'User';
      out.push({ id: i.id, account, accountType, repositorySelection: i.repository_selection ?? 'selected', settingsUrl: installationSettingsUrl(i.id, account, accountType) });
    }
    if ((r.data?.length ?? 0) < 100) break;
  }
  return out;
}

export async function getGithubView(): Promise<GithubAppView> {
  const app = stored();
  if (!app) return { connected: false, app: null, installations: [], lastError: null };
  const view: GithubAppView = {
    connected: true,
    app: {
      name: app.name,
      slug: app.slug,
      owner: app.owner,
      htmlUrl: app.htmlUrl,
      installUrl: installUrl(app.slug),
      settingsUrl: appSettingsUrl(app.slug, app.owner, app.ownerType),
      createdAt: app.createdAt,
    },
    installations: [],
    lastError: null,
  };
  try {
    view.installations = await installations();
  } catch (err) {
    view.lastError = errorMessage(err);
  }
  return view;
}

/** Installation token, optionally narrowed to one repo and to read-only contents. */
async function installationToken(installationId: number, repo?: string): Promise<string> {
  const body = repo ? { repositories: [repo], permissions: { contents: 'read', metadata: 'read' } } : undefined;
  const r = await gh<{ token?: string }>('POST', `/app/installations/${installationId}/access_tokens`, { jwt: true }, body);
  if (!r.data?.token) throw badRequest(t('GitHub không cấp token cho installation {id}', { id: installationId }));
  return r.data.token;
}

type RawRepo = { full_name: string; private: boolean; default_branch: string; clone_url: string };

export async function listRepos(): Promise<GithubRepo[]> {
  if (!stored()) throw conflict(t('Chưa kết nối GitHub'));
  const repos: GithubRepo[] = [];
  for (const inst of await installations()) {
    const token = await installationToken(inst.id);
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await gh<{ repositories?: RawRepo[] }>('GET', `/installation/repositories?per_page=100&page=${page}`, { token });
      const list = r.data?.repositories ?? [];
      for (const x of list) repos.push({ fullName: x.full_name, private: x.private, defaultBranch: x.default_branch, cloneUrl: x.clone_url });
      if (list.length < 100) break;
    }
  }
  return repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Installation that can read `owner/repo`, or null when the App has no access to it. */
async function installationFor(owner: string, repo: string): Promise<number | null> {
  const r = await gh<{ id?: number }>('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`, { jwt: true });
  return r.status === 404 ? null : (r.data?.id ?? null);
}

export async function listBranches(fullName: string): Promise<string[]> {
  if (!stored()) throw conflict(t('Chưa kết nối GitHub'));
  const [owner, repo] = fullName.split('/') as [string, string];
  const inst = await installationFor(owner, repo);
  if (!inst) throw badRequest(t('GitHub App chưa được cấp quyền đọc repo {repo}', { repo: fullName }));
  const token = await installationToken(inst, repo);
  const names: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await gh<Array<{ name: string }>>('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100&page=${page}`, { token });
    names.push(...(r.data ?? []).map((b) => b.name));
    if ((r.data?.length ?? 0) < 100) break;
  }
  return names;
}

/**
 * Token git can clone/pull `gitUrl` with: a fresh, read-only installation token for that one repo.
 * Null when GitHub is not connected, the URL is not a github.com repo, or the App cannot see it
 * (a public repo then still clones without one).
 */
export async function cloneTokenFor(gitUrl: string): Promise<string | null> {
  const parsed = parseGithubUrl(gitUrl);
  if (!parsed || !stored()) return null;
  const inst = await installationFor(parsed.owner, parsed.repo);
  return inst ? installationToken(inst, parsed.repo) : null;
}
