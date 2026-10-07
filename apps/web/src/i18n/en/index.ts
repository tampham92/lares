import { SHARED_EN, type Dict } from '@lares/shared';
import { BACKUP_EN } from './backup';
import { BUILDER_EN } from './builder';
import { COMMON_EN } from './common';
import { DNS_EN } from './dns';
import { GITHUB_EN } from './github';
import { LEADS_EN } from './leads';
import { MIGRATIONS_EN } from './migrations';
import { NETWORK_EN } from './network';
import { PAGES_EN } from './pages';
import { RELEASE_EN } from './release';
import { SECURITY_EN } from './security';
import { SITES_EN } from './sites';
import { SITETOOLS_EN } from './sitetools';
import { WPUPDATES_EN } from './wpupdates';

/** English for every web UI string, keyed by its Vietnamese source text. */
export const EN: Dict = { ...SHARED_EN, ...COMMON_EN, ...PAGES_EN, ...SITES_EN, ...MIGRATIONS_EN, ...NETWORK_EN, ...SECURITY_EN, ...BACKUP_EN, ...RELEASE_EN, ...DNS_EN, ...WPUPDATES_EN, ...LEADS_EN, ...SITETOOLS_EN, ...BUILDER_EN, ...GITHUB_EN };
