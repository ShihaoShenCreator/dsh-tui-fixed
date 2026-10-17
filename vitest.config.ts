import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Resolves @deepseek-ai/* and the package's own paths from node_modules and
  // tsconfig; the sibling deepseek-harness checkout is no longer required.
  plugins: [tsconfigPaths({
    projects: [
      './tsconfig.vitest.json',
    ],
  })],
  test: {
    include: ['tests/**/*.spec.ts'],
    pool: 'forks',
  },
})
