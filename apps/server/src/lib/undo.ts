import { t } from '../i18n/index.js';

/** LIFO stack of compensating actions, run when a multi-step operation fails half way. */
export class UndoStack {
  private steps: Array<{ label: string; fn: () => Promise<unknown> }> = [];

  push(label: string, fn: () => Promise<unknown>) {
    this.steps.push({ label, fn });
  }

  async run(log?: (msg: string) => void) {
    while (this.steps.length) {
      const s = this.steps.pop()!;
      try {
        await s.fn();
        log?.(`Rollback: ${s.label}`);
      } catch (err) {
        log?.(t('Rollback thất bại ({label}): {error}', { label: s.label, error: err instanceof Error ? err.message : String(err) }));
      }
    }
  }

  clear() {
    this.steps = [];
  }
}
