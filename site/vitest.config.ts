import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    // content.ts imports the Sanity client eagerly (even in fixture mode, the
    // client is constructed at module load), so createClient needs these
    // even though fixture mode never sends a request.
    env: {SANITY_FIXTURES: '1', SANITY_PROJECT_ID: '85i3osnk', SANITY_DATASET: 'production'},
    include: ['test/**/*.test.ts'],
  },
})
