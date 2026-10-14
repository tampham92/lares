import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { LARES_DATA_DIR: './data-test', LARES_DRY_RUN: '1' },
    // Test files run in parallel workers on one SQLite file: create it once before they start, or two
    // of them race to switch a new database to WAL or to add the same column (CI starts from scratch).
    globalSetup: './test/globalSetup.ts',
  },
});
