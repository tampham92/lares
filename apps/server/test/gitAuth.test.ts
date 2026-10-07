import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { nextjsConfigSchema } from '@lares/shared';
import { credentialLine, isGitAuthError, tokenUsername } from '../src/services/gitAuth.js';
import { host } from '../src/services/host.js';
import { ngxPath } from '../src/lib/shell.js';
import { summarizeOutput } from '../src/executors/types.js';

describe('git access tokens', () => {
  it('uses the username each host expects', () => {
    expect(tokenUsername('github.com')).toBe('x-access-token');
    expect(tokenUsername('gitlab.com')).toBe('oauth2');
    expect(tokenUsername('gitlab.example.com')).toBe('oauth2');
    expect(tokenUsername('bitbucket.org')).toBe('x-token-auth');
  });

  it('builds a credential-store line for the repo host only', () => {
    expect(credentialLine('https://github.com/org/repo.git', 'github_pat_abc')).toBe('https://x-access-token:github_pat_abc@github.com');
    expect(credentialLine('https://git.example.com:8443/a/b.git', 'tok')).toBe('https://x-access-token:tok@git.example.com:8443');
  });

  it('accepts user:password and encodes special characters', () => {
    expect(credentialLine('https://bitbucket.org/a/b.git', 'me:p@ss/word')).toBe('https://me:p%40ss%2Fword@bitbucket.org');
  });

  it('refuses URLs a token cannot be used with', () => {
    expect(credentialLine('git@github.com:org/repo.git', 'tok')).toBeNull();
    expect(credentialLine('http://github.com/org/repo.git', 'tok')).toBeNull();
  });

  it('recognises git authentication failures', () => {
    expect(isGitAuthError("fatal: could not read Username for 'https://github.com': terminal prompts disabled")).toBe(true);
    expect(isGitAuthError("remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found")).toBe(true);
    expect(isGitAuthError("fatal: Authentication failed for 'https://github.com/a/b.git/'")).toBe(true);
    expect(isGitAuthError("fatal: Remote branch dev not found in upstream origin")).toBe(false);
  });

  it('rejects a token embedded in the Git URL', () => {
    expect(nextjsConfigSchema.safeParse({ gitUrl: 'https://ghp_x@github.com/a/b.git' }).success).toBe(false);
    expect(nextjsConfigSchema.safeParse({ gitUrl: 'https://github.com/a/b.git', gitToken: 'ghp_x' }).success).toBe(true);
    expect(nextjsConfigSchema.safeParse({ gitUrl: 'git@github.com:a/b.git' }).success).toBe(true);
  });
});

describe('asWebUser', () => {
  it("does not pass the panel's environment to site code", async () => {
    process.env.LARES_SECRET_TEST = 'leak';
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const cmd = host.asWebUser('echo "${LARES_SECRET_TEST-unset}:${NODE_ENV-unset}:$CI"', { cwd: os.tmpdir(), home: os.tmpdir() });
      const r = await host.exec(cmd);
      expect(r.stdout.trim()).toBe('unset:unset:1');
    } finally {
      delete process.env.LARES_SECRET_TEST;
      process.env.NODE_ENV = prevNodeEnv;
    }
  });
});

describe('ngxPath', () => {
  it('leaves server paths alone and quotes paths nginx would split', () => {
    expect(ngxPath('/var/www/example.com/public_html')).toBe('/var/www/example.com/public_html');
    expect(ngxPath('/Users/me/My Projects/data/acme')).toBe('"/Users/me/My Projects/data/acme"');
    expect(ngxPath('/tmp/a;b"c')).toBe('"/tmp/a;b\\"c"');
  });
});

describe('summarizeOutput', () => {
  it('shows the error lines instead of a stack-trace tail', () => {
    const out = [
      '> Build error occurred',
      'Error: Turbopack build failed with 1 error:',
      'Warning: Error while requesting resource',
      "Error: Cannot find module '@tailwindcss/postcss'",
      '    [at Module._load (node:internal/modules/cjs/loader:1285:25)]',
      '    at <unknown> (https://nextjs.org/docs/messages/module-not-found)',
      '    at <unknown> ([next]/internal/font/google/x.module.css:169:8)',
    ].join('\n');
    expect(summarizeOutput(out)).toBe("> Build error occurred\nError: Turbopack build failed with 1 error:\nError: Cannot find module '@tailwindcss/postcss'");
  });

  it('keeps the plain tail when there is no stack trace', () => {
    const out = ['a', 'b', 'nginx: [emerg] unknown directive "foo"', 'nginx: configuration file test failed'].join('\n');
    expect(summarizeOutput(out)).toBe(out);
  });
});

describe('asWebUser proxy', () => {
  it('passes proxy settings through to site commands', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.local:3128';
    try {
      const r = await host.exec(host.asWebUser('echo "$HTTPS_PROXY"', { cwd: os.tmpdir(), home: os.tmpdir() }));
      expect(r.stdout.trim()).toBe('http://proxy.local:3128');
    } finally {
      delete process.env.HTTPS_PROXY;
    }
  });
});
