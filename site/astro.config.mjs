import {defineConfig} from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import {loadEnv} from 'vite'

// Load the repo-root .env / .env.local into process.env without clobbering
// anything CI already set.
const fileEnv = loadEnv(process.env.NODE_ENV ?? 'development', '..', '')
for (const [key, value] of Object.entries(fileEnv)) {
  process.env[key] ??= value
}

// One project, two builds. Unset -> the static public site, which ships no
// JavaScript and never invokes a Worker. PREVIEW=1 -> the SSR preview Worker,
// which reads drafts and loads the visual-editing overlay.
const preview = process.env.PREVIEW === '1'

export default defineConfig({
  site: preview ? 'https://preview.softmess.de' : 'https://softmess.de',
  trailingSlash: 'never',
  // Nothing on this site has a session — no forms, no accounts, no client JS.
  // Left at its default, the Cloudflare adapter adds a `SESSION` KV binding and
  // wrangler then tries to auto-provision the namespace on deploy, which fails
  // for any API token without KV write permission. Off is both accurate and one
  // fewer resource to provision.
  session: false,
  output: preview ? 'server' : 'static',
  // configPath is not optional. The adapter generates dist/server/wrangler.json
  // from a wrangler config and, left to itself, picks up the default-named
  // wrangler.jsonc — which is the *static* site's: name `softmess`, routed at
  // softmess.de. Deploying that output would put the SSR preview app on the
  // production domain. Naming the preview config keeps the generated one
  // correct, and `wrangler deploy` then follows .wrangler/deploy/config.json to
  // it. Do not pass `--config wrangler.preview.jsonc` to that deploy: it
  // overrides the redirect and uploads entry.mjs without its chunks, which
  // deploys cleanly and then 404s every route.
  adapter: preview ? cloudflare({configPath: 'wrangler.preview.jsonc'}) : undefined,
  // React exists only to host the visual-editing overlay island. Registering
  // the renderer only in preview mode is what keeps it out of the public build.
  integrations: preview ? [react()] : [],
  vite: {
    plugins: [tailwindcss()],
    // Inlined at build time so `if (import.meta.env.PREVIEW)` branches are
    // eliminated entirely from the static bundle, imports included.
    define: {'import.meta.env.PREVIEW': JSON.stringify(preview)},
    // @sanity/visual-editing is React-Compiler output, so it imports {c} from
    // react-compiler-runtime — a CommonJS package with no named exports until
    // Vite pre-bundles it. Without this the overlay island fails to hydrate.
    // Pre-bundle the whole package, not its deps one at a time: pnpm symlinks it
    // outside site/, so Vite serves it raw and each CommonJS dep in its chain
    // (react-compiler-runtime, react-is, …) reaches the browser without named
    // exports. Nested syntax because it is not a direct dependency of site/.
    optimizeDeps: preview
      ? {include: ['@sanity/astro > @sanity/visual-editing/react']}
      : undefined,
  },
})
