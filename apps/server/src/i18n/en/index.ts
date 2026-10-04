import { SHARED_EN, type Dict } from '@lares/shared';
import { BACKUP_EN } from './backup.js';
import { CORE_EN } from './core.js';
import { MIGRATION_EN } from './migration.js';
import { SERVICES_EN } from './services.js';

/** English for every server message, keyed by its Vietnamese source text. */
export const EN: Dict = { ...SHARED_EN, ...BACKUP_EN, ...CORE_EN, ...SERVICES_EN, ...MIGRATION_EN };
