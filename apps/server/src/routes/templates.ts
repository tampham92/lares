import type { FastifyInstance } from 'fastify';
import { brandingSchema, templateIdSchema } from '@tpanel/shared';
import { requireAuth } from '../auth/index.js';
import { parse } from '../lib/validate.js';
import { getTemplate, listTemplates, renderStaticPage, templateVars } from '../services/templates.js';

export async function templateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/templates', () => listTemplates());

  /** Full-page preview for the "Add site" gallery (loaded in a sandboxed iframe, auth via ?token=). */
  app.get('/api/templates/:id/preview', async (req, reply) => {
    const id = parse(templateIdSchema, (req.params as { id: string }).id);
    const q = req.query as Record<string, string | undefined>;
    const branding = parse(brandingSchema, { siteName: q.siteName || undefined, tagline: q.tagline || undefined, phone: q.phone || undefined, email: q.email || undefined, address: q.address || undefined });
    const t = await getTemplate(id);
    reply.header('Content-Security-Policy', 'sandbox allow-scripts; frame-ancestors \'self\'');
    reply.type('text/html; charset=utf-8');
    return renderStaticPage(t.id, templateVars(t, branding));
  });
}
