import { z } from 'zod';
import { msg } from './i18n.js';

// ---------------------------------------------------------------------------
// Cloudflare DNS: API token, server public IP, A/AAAA records for site hostnames
// ---------------------------------------------------------------------------

// Not imported from ./index.js: index re-exports this file, and the cycle would leave it undefined here.
const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/i, msg('Tên miền không hợp lệ'));

const hostnameList = z.array(hostnameSchema).max(20);

/** Where to create a token, and the permissions Lares needs. */
export const CLOUDFLARE_TOKEN_URL = 'https://dash.cloudflare.com/profile/api-tokens';

export const cloudflareTokenSchema = z.object({
  // Cloudflare tokens are ~40 printable characters; anything with spaces is a copy-paste accident.
  token: z
    .string()
    .trim()
    .min(20, msg('API token không hợp lệ'))
    .max(400, msg('API token không hợp lệ'))
    .regex(/^[\x21-\x7e]+$/, msg('API token không hợp lệ')),
});
export type CloudflareTokenInput = z.infer<typeof cloudflareTokenSchema>;

const optionalIp = (version: 'v4' | 'v6', message: string) =>
  z
    .string()
    .trim()
    .ip({ version, message })
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null))
    .transform((v) => v ?? null);

/** Manual override of the detected public IP (empty = use the detected address). */
export const serverIpSchema = z.object({
  ipv4: optionalIp('v4', msg('Địa chỉ IPv4 không hợp lệ')),
  ipv6: optionalIp('v6', msg('Địa chỉ IPv6 không hợp lệ')),
  /** Never create AAAA records (the server has IPv6 but it is not reachable from outside). */
  ipv6Disabled: z.boolean().default(false),
});
export type ServerIpInput = z.infer<typeof serverIpSchema>;

/** Preview what Lares would do for these hostnames. */
export const dnsPlanSchema = z.object({
  hostnames: hostnameList.min(1),
  /** Panel hostname: plan the A record only (the panel listens on IPv4). */
  ipv4Only: z.boolean().default(false),
});

/** Create/update records of a site; `overwrite` lists the hostnames whose conflicting records the admin agreed to replace. */
export const dnsApplySchema = z.object({
  hostnames: hostnameList.min(1).optional(),
  overwrite: hostnameList.default([]),
});
export type DnsApplyInput = z.infer<typeof dnsApplySchema>;

export const dnsProxySchema = z.object({
  /** Empty/missing = every hostname of the site. */
  hostnames: hostnameList.min(1).optional(),
  proxied: z.boolean(),
});
export type DnsProxyInput = z.infer<typeof dnsProxySchema>;

/** Extra, optional field of "Add site" and "Assign domain" requests: create the records in the same task. */
export const autoDnsSchema = z.object({ overwrite: hostnameList.default([]) });
export type AutoDnsInput = z.infer<typeof autoDnsSchema>;
export const autoDnsBodySchema = z.object({ cloudflareDns: autoDnsSchema.optional() });

/** Panel hostname record: always DNS only (Cloudflare does not proxy the panel port). */
export const panelDnsSchema = z.object({ domain: hostnameSchema, overwrite: z.boolean().default(false) });

export interface CloudflareZone {
  id: string;
  name: string;
  /** active | pending | initializing | moved... (pending = nameservers not switched yet) */
  status: string;
}

export interface CloudflareDnsView {
  /** A verified token is stored. */
  connected: boolean;
  /** First/last characters only, e.g. "abcd…wxyz" - the token itself never leaves the server. */
  tokenHint: string | null;
  verifiedAt: string | null;
  accountName: string | null;
  zones: CloudflareZone[];
  lastError: string | null;
}

export interface ServerIpView {
  /** Addresses used for records (override, else detected; IPv6 null when disabled). */
  ipv4: string | null;
  ipv6: string | null;
  detected: { ipv4: string | null; ipv6: string | null; at: string | null };
  override: { ipv4: string | null; ipv6: string | null };
  ipv6Disabled: boolean;
}

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME';

export interface DnsRecordBrief {
  id: string;
  type: DnsRecordType;
  content: string;
  proxied: boolean;
}

/**
 * What "create/update records" would do for one record type of one hostname:
 * - none: nothing wanted, nothing there
 * - ok: already points to this server
 * - create: no record yet
 * - update / delete: only records that already belong to this server (created by Lares, or one of its own addresses)
 * - conflict: something else is there (another IP, a CNAME) - changed only with explicit "overwrite"
 */
export type DnsPlanAction = 'none' | 'ok' | 'create' | 'update' | 'delete' | 'conflict';

export interface DnsRecordPlan {
  type: 'A' | 'AAAA';
  /** Wanted content; null = this server has no address of that family. */
  content: string | null;
  action: DnsPlanAction;
  /** Records involved (same type, plus a CNAME that blocks it). */
  existing: DnsRecordBrief[];
}

export interface HostnameDnsPlan {
  hostname: string;
  /** Connected Cloudflare zone the hostname belongs to, null = not managed through Cloudflare. */
  zone: CloudflareZone | null;
  records: DnsRecordBrief[];
  plan: DnsRecordPlan[];
  /** Cloudflare could not be queried for this hostname. */
  error: string | null;
}

export interface DnsPlanResult {
  connected: boolean;
  ipv4: string | null;
  ipv6: string | null;
  hostnames: HostnameDnsPlan[];
}

export interface HostnameDnsStatus extends HostnameDnsPlan {
  /** Public DNS answer (1.1.1.1 / 8.8.8.8). */
  resolved: { a: string[]; aaaa: string[]; error: string | null };
  /** Resolves to this server. */
  pointsHere: boolean;
  /** Resolves to Cloudflare edge addresses (proxied). */
  viaCloudflare: boolean;
  /** Cloudflare records pointing to this server: all proxied (true), all DNS only (false), none (null). */
  proxied: boolean | null;
}

export interface SiteDnsStatus {
  connected: boolean;
  ipv4: string | null;
  ipv6: string | null;
  sslEnabled: boolean;
  hostnames: HostnameDnsStatus[];
}

export interface DnsActionResult {
  messages: Array<{ level: 'info' | 'warn'; text: string }>;
}
