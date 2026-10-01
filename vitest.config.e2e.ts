import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['test/vitest.e2e.setup.ts'],
    // Each suite opens a real connection to Neon
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
