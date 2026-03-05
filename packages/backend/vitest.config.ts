import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@debugger/shared': resolve(__dirname, '../shared/src/types/index.ts'),
    },
  },
  test: {
    globals: true,
  },
});
