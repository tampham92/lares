import { z } from 'zod';
import { msg } from './i18n.js';

/**
 * GitHub App: each panel registers its own App through GitHub's manifest flow, so the App's private
 * key stays on this server and no third party sits between the panel and GitHub.
 */

export const githubManifestSchema = z.object({
  /** The panel's origin as the browser sees it: GitHub sends the admin back there. */
  origin: z
    .string()
    .trim()
    .url(msg('Địa chỉ panel không hợp lệ'))
    .regex(/^https?:\/\/[^/?#\s]+\/?$/, msg('Địa chỉ panel không hợp lệ'))
    .transform((u) => new URL(u).origin),
  /** Create the App under an organization instead of the admin's personal account. */
  org: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, msg('Tên tổ chức GitHub không hợp lệ'))
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
export type GithubManifestInput = z.infer<typeof githubManifestSchema>;

export const githubConvertSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/, msg('Mã xác nhận GitHub không hợp lệ')),
  state: z.string().regex(/^[a-f0-9]{32}$/, msg('Mã xác nhận GitHub không hợp lệ')),
});

/** `owner/repo` as GitHub names them. */
export const githubRepoNameSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/, msg('Tên repo không hợp lệ'));

/** What the browser posts to GitHub to create the App. */
export interface GithubManifestStart {
  action: string;
  manifest: string;
}

export interface GithubInstallation {
  id: number;
  account: string;
  accountType: string;
  /** "all" repos of the account or only the "selected" ones. */
  repositorySelection: string;
  /** Where the admin changes which repos the App can read. */
  settingsUrl: string;
}

export interface GithubAppView {
  connected: boolean;
  app: {
    name: string;
    slug: string;
    owner: string;
    htmlUrl: string;
    /** Install on an account / pick repos. */
    installUrl: string;
    /** The App's own settings page, e.g. to delete it after disconnecting. */
    settingsUrl: string;
    createdAt: string;
  } | null;
  installations: GithubInstallation[];
  lastError: string | null;
}

export interface GithubRepo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  cloneUrl: string;
}

/** `{ owner, repo }` of an https://github.com URL, or null for any other host or shape. */
export function parseGithubUrl(gitUrl: string): { owner: string; repo: string } | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(gitUrl.trim());
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

/** Same repo, ignoring case and a trailing `.git` (GitHub treats both as one). */
export function sameGithubRepo(a: string, b: string): boolean {
  const pa = parseGithubUrl(a);
  const pb = parseGithubUrl(b);
  return !!pa && !!pb && pa.owner.toLowerCase() === pb.owner.toLowerCase() && pa.repo.toLowerCase() === pb.repo.toLowerCase();
}
