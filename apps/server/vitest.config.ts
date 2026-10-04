import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { LARES_DATA_DIR: './data-test', LARES_DRY_RUN: '1' },
  },
});
