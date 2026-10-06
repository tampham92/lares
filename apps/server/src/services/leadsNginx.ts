import fs from 'node:fs';
import { LEAD_FORM_PATH, LEAD_PANEL_PATH } from '@lares/shared';
import { config } from '../config.js';

/**
 * nginx side of lead capture: every (non-suspended) Lares vhost gets an exact-match location
 * for LEAD_FORM_PATH that proxies to the panel over loopback. nginx sets the headers that
 * identify the site, the visitor's host and the real client IP; proxy_set_header replaces any
 * copy the client sent. Cookies and Authorization never reach the panel.
 *
 * Kept free of other service imports so services/nginx.ts can include it without a cycle.
 */

/** Same rule as index.ts uses to decide whether the panel serves HTTPS. */
export function panelServesTls(): boolean {
  return !!(config.tlsCert && config.tlsKey && fs.existsSync(config.tlsCert) && fs.existsSync(config.tlsKey));
}

/** Where nginx reaches the panel. The panel listens on 0.0.0.0 by default, so 127.0.0.1 works. */
export function panelLeadUpstream(tls = panelServesTls(), port = config.port): string {
  return `${tls ? 'https' : 'http'}://127.0.0.1:${port}${LEAD_PANEL_PATH}`;
}

export const LEAD_SITE_HEADER = 'x-lares-site';
export const LEAD_CLIENT_IP_HEADER = 'x-lares-client-ip';
export const LEAD_HOST_HEADER = 'x-lares-host';
export const LEAD_SCHEME_HEADER = 'x-lares-scheme';

/** The location block (unindented). `domain` is a validated site domain (or siteNNNN.localhost). */
export function leadLocation(domain: string, upstream = panelLeadUpstream()): string {
  return `# Lares lead capture: contact forms post here, the panel stores the lead
location = ${LEAD_FORM_PATH} {
    limit_except POST {
        deny all;
    }
    client_max_body_size 64k;
    proxy_pass ${upstream};
    proxy_set_header X-Lares-Site "${domain}";
    proxy_set_header X-Lares-Client-IP $remote_addr;
    proxy_set_header X-Lares-Host $http_host;
    proxy_set_header X-Lares-Scheme $scheme;
    proxy_set_header X-Forwarded-For "";
    proxy_set_header X-Real-IP "";
    proxy_set_header Cookie "";
    proxy_set_header Authorization "";
    proxy_ssl_verify off;
    proxy_connect_timeout 5s;
    proxy_read_timeout 20s;
}`;
}

const normalize = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');

/** Does this vhost file already carry the current lead location (same upstream, same site)? */
export function hasCurrentLeadLocation(vhost: string, domain: string, upstream = panelLeadUpstream()): boolean {
  return normalize(vhost).includes(normalize(leadLocation(domain, upstream)));
}
