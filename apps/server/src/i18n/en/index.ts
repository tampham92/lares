import { SHARED_EN, type Dict } from '@lares/shared';
import { BACKUP_EN } from './backup.js';
import { BUILDER_EN } from './builder.js';
import { CORE_EN } from './core.js';
import { DNS_EN } from './dns.js';
import { GITHUB_EN } from './github.js';
import { ISOLATION_EN } from './isolation.js';
import { LEADS_EN } from './leads.js';
import { MIGRATION_EN } from './migration.js';
import { NETWORK_EN } from './network.js';
import { RELEASE_EN } from './release.js';
import { SECURITY_EN } from './security.js';
import { SERVICES_EN } from './services.js';
import { SITETOOLS_EN } from './sitetools.js';
import { WPUPDATES_EN } from './wpupdates.js';

/** English for every server message, keyed by its Vietnamese source text. */
export const EN: Dict = { ...SHARED_EN, ...CORE_EN, ...SERVICES_EN, ...MIGRATION_EN, ...NETWORK_EN, ...SECURITY_EN, ...BACKUP_EN, ...RELEASE_EN, ...DNS_EN, ...WPUPDATES_EN, ...LEADS_EN, ...SITETOOLS_EN, ...BUILDER_EN, ...GITHUB_EN, ...ISOLATION_EN };
