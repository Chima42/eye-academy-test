import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts so tests don't load the TanStack Start plugin.
// `npm test` runs the offline unit tests; `npm run test:checks` runs the live checks
// (real Claude / Deepgram calls, keys from .env.local).
export default defineConfig(({ mode }) => ({
  test: {
    include: mode === 'checks' ? ['tests/**/*.live.test.ts'] : ['src/**/*.test.ts'],
    env: loadEnv(mode === 'checks' ? 'development' : mode, process.cwd(), ''),
    testTimeout: 60_000,
  },
}))
