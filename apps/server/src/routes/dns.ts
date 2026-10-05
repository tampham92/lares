import type { FastifyInstance } from 'fastify';
import { cloudflareTokenSchema, dnsApplySchema, dnsPlanSchema, dnsProxySchema, panelDnsSchema, serverIpSchema, type Site } from '@lares/shared';
import { requireAuth } from '../auth/index.js';
import { t } from '../i18n/index.js';
import { badRequest, conflict } from '../lib/errors.js';
import { idParam, parse } from '../lib/validate.js';
import {
  applyDnsRecords,
  collectOut,
  connectCloudflare,
  disconnectCloudflare,
  ensurePanelRecord,
  getCloudflareDnsView,
  planDns,
  refreshCloudflare,
  setProxied,
  siteDnsStatus,
  siteHostnames,
} from '../services/cloudflareDns.js';
import { getServerIp, saveServerIp } from '../services/publicIp.js';
import * as sites from '../services/sites.js';

/** Only hostnames that belong to the site (default: all of them). */
function pickHostnames(site: Site, requested?: string[]): string[] {
  const all = siteHostnames(site);
  if (!all.length) throw conflict(t('Site đang chạy theo port (chưa có tên miền) nên không có bản ghi DNS'));
  if (!requested) return all;
  const foreign = requested.find((h) => !all.includes(h));
  if (foreign) throw badRequest(t('{hostname} không thuộc site này', { hostname: foreign }));
  return requested;
}

export async function dnsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ---- Settings: Cloudflare API token ----------------------------------------------

  app.get('/api/dns/cloudflare', () => getCloudflareDnsView());
  app.put('/api/dns/cloudflare', async (req) => connectCloudflare(parse(cloudflareTokenSchema, req.body).token));
  app.post('/api/dns/cloudflare/refresh', () => refreshCloudflare());
  app.delete('/api/dns/cloudflare', () => disconnectCloudflare());

  // ---- Settings: server public IP ---------------------------------------------------

  app.get('/api/dns/server-ip', () => getServerIp());
  app.put('/api/dns/server-ip', async (req) => saveServerIp(parse(serverIpSchema, req.body)));
  app.post('/api/dns/server-ip/detect', () => getServerIp({ refresh: true }));

  // ---- Records ----------------------------------------------------------------------

  /** Preview for the "Add site" / "Assign domain" forms. */
  app.post('/api/dns/plan', async (req) => {
    const input = parse(dnsPlanSchema, req.body);
    return planDns(input.hostnames, { ipv4Only: input.ipv4Only });
  });

  app.get('/api/sites/:id/dns', async (req) => siteDnsStatus(sites.getSite(idParam(req.params))));

  app.post('/api/sites/:id/dns/records', async (req) => {
    const site = sites.getSite(idParam(req.params));
    const input = parse(dnsApplySchema, req.body ?? {});
    const { out, result } = collectOut();
    await applyDnsRecords(pickHostnames(site, input.hostnames), { overwrite: input.overwrite }, out);
    return result;
  });

  app.post('/api/sites/:id/dns/proxy', async (req) => {
    const site = sites.getSite(idParam(req.params));
    const input = parse(dnsProxySchema, req.body);
    const hostnames = pickHostnames(site, input.hostnames);
    // behind the proxy Cloudflare talks HTTPS to the origin ("Full (strict)"): the certificate comes first
    if (input.proxied && !site.ssl.enabled) throw conflict(t('Cài SSL cho site trước khi bật proxy Cloudflare'));
    const { out, result } = collectOut();
    await setProxied(hostnames, input.proxied, out);
    return result;
  });

  /** Settings → panel domain: A/AAAA for the panel hostname, DNS only. */
  app.post('/api/dns/panel-record', async (req) => {
    const input = parse(panelDnsSchema, req.body);
    const owner = sites.findSiteByHostname(input.domain);
    if (owner) throw conflict(t('{name} đang được dùng bởi site {domain}', { name: input.domain, domain: owner.domain }));
    const { out, result } = collectOut();
    await ensurePanelRecord(input.domain, input.overwrite, out);
    return result;
  });
}
