import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    // content.ts imports the Sanity client eagerly (even in fixture mode, the
    // client is constructed at module load), so createClient needs these
    // even though fixture mode never sends a request.
    //
    // PREVIEW and PROXY_IMAGES do NOT belong in `define`: Vite's own
    // import.meta.env object wins over a `define` entry for that namespace,
    // so every value under test arrives here as whatever string `test.env`
    // gives it, never as the boolean `define` would suggest. PREVIEW is ''
    // because '' is falsy — that is what makes `!import.meta.env.PREVIEW`
    // behave under test the way the static build behaves, where the constant
    // is actually inlined `false`.
    env: {
      SANITY_FIXTURES: '1',
      SANITY_PROJECT_ID: '85i3osnk',
      SANITY_DATASET: 'production',
      // Forwarded explicitly: vitest does not pass the ambient value through to
      // the test environment, and dist.test.ts has to know which shape the
      // build it is inspecting actually emitted.
      PROXY_IMAGES: process.env.PROXY_IMAGES ?? '',
      PREVIEW: '',
    },
    include: ['test/**/*.test.ts'],
  },
})
