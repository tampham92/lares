import { z } from 'zod';

// ---------------------------------------------------------------------------
// Network: real visitor IP behind Cloudflare, trusted certificate for the panel
// ---------------------------------------------------------------------------

// Not imported from ./index.js: index re-exports this file, and the cycle would leave it undefined here.
const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/i, 'Tên miền không hợp lệ');

export const cloudflareSettingsSchema = z.object({
  enabled: z.boolean(),
});
export type CloudflareSettingsInput = z.infer<typeof cloudflareSettingsSchema>;

export interface CloudflareRealIpView {
  /** nginx restores the visitor IP (CF-Connecting-IP) for requests coming from Cloudflare. */
  enabled: boolean;
  ipv4: string[];
  ipv6: string[];
  /** Last time the list was downloaded from cloudflare.com (null = bundled list). */
  fetchedAt: string | null;
  /** Last refresh attempt, successful or not. */
  checkedAt: string | null;
  lastError: string | null;
  confPath: string;
}

export const panelDomainSchema = z.object({
  domain: hostnameSchema,
  email: z.string().trim().email('Email không hợp lệ').optional().or(z.literal('').transform(() => undefined)),
  /** Continue even if DNS does not (yet) resolve to this server. */
  ignoreDns: z.boolean().default(false),
});
export type PanelDomainInput = z.infer<typeof panelDomainSchema>;

export const panelDomainCheckSchema = z.object({ domain: hostnameSchema });

export interface PanelDomainView {
  /** Hostname with a Let's Encrypt certificate, null = self-signed certificate. */
  domain: string | null;
  email: string | null;
  /** Address to open the panel with (https://<domain>:<port>), null without a domain. */
  url: string | null;
  port: number;
  /** Whether the panel currently serves HTTPS at all. */
  https: boolean;
  certFile: string | null;
  issuer: string | null;
  expiresAt: string | null;
}
