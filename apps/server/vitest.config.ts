import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { TPANEL_DATA_DIR: './data-test', TPANEL_DRY_RUN: '1' },
  },
});
