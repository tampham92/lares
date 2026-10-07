/**
 * Access tokens for private Git repos (pure, no I/O).
 *
 * The token reaches git through a temporary `credential-store` file, never through the clone URL
 * or the command line: a URL with credentials is saved in .git/config and printed in task logs,
 * and a command line is visible to every user on the machine via `ps`.
 */

/** Username each host expects alongside a token sent as the HTTPS password. */
export function tokenUsername(host: string): string {
  if (host === 'bitbucket.org') return 'x-token-auth';
  if (host === 'gitlab.com' || host.startsWith('gitlab.')) return 'oauth2';
  // GitHub ignores the username for tokens; most others (Gitea, self-hosted) accept any non-empty one.
  return 'x-access-token';
}

/**
 * One line for `git credential-store`: `https://user:token@host`.
 * `token` may also be `user:password` for hosts that need a real username (Bitbucket app passwords).
 * Null when the URL is not https:// (a git@ URL authenticates with SSH keys, not tokens).
 */
export function credentialLine(gitUrl: string, token: string): string | null {
  let url: URL;
  try {
    url = new URL(gitUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const sep = token.indexOf(':');
  const user = sep > 0 ? token.slice(0, sep) : tokenUsername(url.hostname);
  const secret = sep > 0 ? token.slice(sep + 1) : token;
  return `https://${encodeURIComponent(user)}:${encodeURIComponent(secret)}@${url.host}`;
}

/** git's messages when a repo needs credentials (private repo, wrong or expired token). */
export const isGitAuthError = (output: string) =>
  /could not read Username|Authentication failed|Invalid username or password|Repository not found|returned error: 40[134]|terminal prompts disabled/i.test(output);
