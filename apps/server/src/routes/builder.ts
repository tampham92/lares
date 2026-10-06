import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { builderSpecSchema, saveBuilderTemplateSchema, templateIdSchema } from '@lares/shared';
import { requireAuth } from '../auth/index.js';
import { parse } from '../lib/validate.js';
import {
  deleteBuilderTemplate,
  listBuilderPresets,
  manifestFromSpec,
  previewFrameHtml,
  resolveAsset,
  saveBuilderTemplate,
} from '../services/builder/index.js';
import { renderStaticPage, templateVars } from '../services/templates.js';

const PREVIEW_CSP = "sandbox allow-scripts; frame-ancestors 'self'";
const TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', woff2: 'font/woff2' };

const bearer = (h: string | undefined) => (h?.startsWith('Bearer ') ? h.slice(7) : undefined);

/** Site builder ("Trình tạo giao diện"): presets, live preview, saved designs. Sites are created via POST /api/sites with `builder`. */
export async function builderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/builder/presets', () => listBuilderPresets());

  /** Normalises an imported JSON spec (or reports the first problem). */
  app.post('/api/builder/validate', async (req) => ({ spec: parse(builderSpecSchema, (req.body as { spec?: unknown } | null)?.spec) }));

  /** Rendered page for the live preview; asset URLs carry the caller's token (the iframe has no session). */
  app.post('/api/builder/render', async (req) => {
    const spec = parse(builderSpecSchema, (req.body as { spec?: unknown } | null)?.spec);
    const tpl = manifestFromSpec(spec);
    return { html: await renderStaticPage(tpl, templateVars(tpl, {}), { token: bearer(req.headers.authorization) }) };
  });

  /** Sandboxed shell the panel posts rendered pages into (served from the panel origin, like the template preview). */
  app.get('/api/builder/frame', async (_req, reply) => {
    reply.header('Content-Security-Policy', PREVIEW_CSP);
    reply.type('text/html; charset=utf-8');
    return previewFrameHtml();
  });

  /** Bundled fonts and template images (used by previews and thumbnails). */
  app.get('/api/builder/asset/:scope/:file', async (req, reply) => {
    const { scope, file } = req.params as { scope: string; file: string };
    const p = await resolveAsset(scope, file);
    reply.header('Cache-Control', 'private, max-age=86400');
    // fonts requested from the sandboxed (opaque-origin) preview are CORS requests
    reply.header('Access-Control-Allow-Origin', '*');
    reply.type(TYPES[file.split('.').pop()!] ?? 'application/octet-stream');
    return fs.readFile(p);
  });

  app.post('/api/builder/templates', async (req) => {
    const input = parse(saveBuilderTemplateSchema.extend({ id: templateIdSchema.optional() }), req.body);
    return saveBuilderTemplate(input);
  });

  app.delete('/api/builder/templates/:id', async (req) => {
    await deleteBuilderTemplate(parse(templateIdSchema, (req.params as { id: string }).id));
    return { ok: true };
  });
}
