import { SHARED_EN, type Dict } from '@lares/shared';
import { COMMON_EN } from './common';
import { MIGRATIONS_EN } from './migrations';
import { PAGES_EN } from './pages';
import { RELEASE_EN } from './release';
import { SITES_EN } from './sites';

/** English for every web UI string, keyed by its Vietnamese source text. */
export const EN: Dict = { ...SHARED_EN, ...COMMON_EN, ...PAGES_EN, ...SITES_EN, ...MIGRATIONS_EN, ...RELEASE_EN };
