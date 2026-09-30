import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  // the shared workspace package ships TypeScript sources, so bundle it into the server build
  noExternal: ['@tpanel/shared'],
});
