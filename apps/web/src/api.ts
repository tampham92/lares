import { getLang, locale } from './i18n';

const TOKEN_KEY = 'lares_token';

export const auth = {
  get token() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Lares-Lang': getLang() };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  const res = await fetch(path, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    auth.set(null);
    window.location.href = '/login';
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? res.statusText);
  return data as T;
}

export const get = <T>(p: string) => api<T>(p);
export const post = <T>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const put = <T>(p: string, body: unknown) => api<T>(p, { method: 'PUT', body });
export const patch = <T>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body });
export const del = <T>(p: string, body?: unknown) => api<T>(p, { method: 'DELETE', body });

/** Ends this session on the server (or every session of the user), then forgets the token. */
export async function logout(everywhere = false) {
  try {
    if (auth.token) await post(everywhere ? '/api/auth/logout-all' : '/api/auth/logout');
  } catch {
    /* already invalid - nothing to revoke */
  }
  auth.set(null);
}

export interface TaskInfo {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'failed';
  logs: Array<{ t: string; msg: string }>;
  totalLines: number;
  result?: unknown;
  error?: string;
}

export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export const fmtDate = (s: string | null | undefined) => (s ? new Date(s.endsWith('Z') || s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).toLocaleString(locale()) : '—');

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** What to type in a browser: http://<panel host>:<port> for port-based sites, the domain otherwise. */
export function siteHref(site: { domain: string; listenPort: number | null; ssl: { enabled: boolean } }): string {
  if (site.listenPort) return `http://${window.location.hostname}:${site.listenPort}`;
  return `${site.ssl.enabled ? 'https' : 'http'}://${site.domain}`;
}

export const siteLabel = (site: { domain: string; listenPort: number | null }) =>
  site.listenPort ? `${window.location.hostname}:${site.listenPort}` : site.domain;
