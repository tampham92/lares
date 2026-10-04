import { EventEmitter } from 'node:events';
import type { MigrationEvent } from '@lares/shared';

const bus = new EventEmitter();
bus.setMaxListeners(200);

export function emitMigration(migrationId: number, event: MigrationEvent) {
  bus.emit(`m:${migrationId}`, event);
}

export function subscribeMigration(migrationId: number, fn: (e: MigrationEvent) => void): () => void {
  bus.on(`m:${migrationId}`, fn);
  return () => bus.off(`m:${migrationId}`, fn);
}
