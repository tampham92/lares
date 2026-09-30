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
        log?.(`Rollback thất bại (${s.label}): ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  clear() {
    this.steps = [];
  }
}
