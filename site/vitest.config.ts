import {defineConfig} from 'vitest/config'
import {loadEnv} from 'vite'

// vitest reads no env file of its own, so `pnpm verify:live` used to run 7 of
// its 20 assertions and report green — the whole draft-mode handshake block,
// including the Partitioned cookie whose absence broke Presentation
// invisibly, skipped in silence on the one machine that actually holds the
// token. Load the repo-root .env/.env.local the way astro.config.mjs does, but
// only for the live run: the offline run must stay unable to reach Sanity, or a
// fixture test that quietly hits the API passes for the wrong reason.
const fileEnv = process.env.LIVE === '1' ? loadEnv('development', '..', '') : {}

// Ambient values win, so `SITE_URL=… pnpm verify:live` still overrides the file,
// and a key that is in neither is left absent rather than set to '' — the tests
// skip on absence, and an empty string would read as "answered, with nothing".
const liveEnv = Object.fromEntries(
  ['SANITY_API_TOKEN', 'PREVIEW_DRAFT_SECRET', 'SITE_URL', 'PREVIEW_URL']
    .filter((key) => !process.env[key] && fileEnv[key])
    .map((key) => [key, fileEnv[key]]),
)

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
      // Empty unless LIVE=1 — see above.
      ...liveEnv,
    },
    include: ['test/**/*.test.ts'],
  },
})
