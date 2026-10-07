import type { FastifyInstance } from 'fastify';
import { githubConvertSchema, githubManifestSchema, githubRepoNameSchema } from '@lares/shared';
import { requireAuth } from '../auth/index.js';
import { parse } from '../lib/validate.js';
import { completeManifest, disconnectGithub, getGithubView, listBranches, listRepos, startManifest } from '../services/githubApp.js';

export async function githubRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/github', () => getGithubView());
  app.delete('/api/github', () => disconnectGithub());

  /** Step 1: the browser posts the returned manifest to GitHub. */
  app.post('/api/github/manifest', async (req) => {
    const input = parse(githubManifestSchema, req.body);
    return startManifest(input.origin, input.org);
  });
  /** Step 2: GitHub sent the admin back with a one-time code. */
  app.post('/api/github/manifest/convert', async (req) => {
    const input = parse(githubConvertSchema, req.body);
    return completeManifest(input.code, input.state);
  });

  app.get('/api/github/repos', () => listRepos());
  app.get('/api/github/branches', async (req) => listBranches(parse(githubRepoNameSchema, (req.query as { repo?: string }).repo)));
}
