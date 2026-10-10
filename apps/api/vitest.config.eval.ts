import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Quality evaluations (retrieval, answers) on real data: not part of `npm test`. See test/eval/*.eval.ts.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['test/eval/**/*.eval.ts'],
    testTimeout: 900_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
