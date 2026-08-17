import {defineConfig} from 'vitest/config'

// The image proxy is a build-time flag, so tests have to see the same value the
// build did. Read from the environment rather than pinned here: `pnpm test`
// sets PROXY_IMAGES=1 so the proxied path is covered offline, while
// `build:site:deploy` inherits whatever production actually ships with.
const proxyImages = process.env.PROXY_IMAGES === '1'

export default defineConfig({
  define: {
    'import.meta.env.PROXY_IMAGES': JSON.stringify(proxyImages),
    // Nothing under test runs as the preview Worker; keeping it defined stops
    // the branch in lib/image.ts from reading undefined off import.meta.env.
    'import.meta.env.PREVIEW': JSON.stringify(false),
  },
  test: {
    // content.ts imports the Sanity client eagerly (even in fixture mode, the
    // client is constructed at module load), so createClient needs these
    // even though fixture mode never sends a request.
    env: {
      SANITY_FIXTURES: '1',
      SANITY_PROJECT_ID: '85i3osnk',
      SANITY_DATASET: 'production',
      // Forwarded explicitly: vitest does not pass the ambient value through to
      // the test environment, and dist.test.ts has to know which shape the
      // build it is inspecting actually emitted.
      PROXY_IMAGES: process.env.PROXY_IMAGES ?? '',
    },
    include: ['test/**/*.test.ts'],
  },
})
