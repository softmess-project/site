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

// Whether the static build emits same-origin /cdn/* image URLs instead of
// cdn.sanity.io ones. Off by default, and that default is load-bearing: the
// /cdn route works only if the Worker can reach cdn.sanity.io, and right now
// Workers on the softmess.de zone get HTTP 525 doing exactly that
// (docs/BACKLOG.md §1.1). Shipping the proxied URLs before that is fixed would
// break every image on the site, so the safe shape is the default and this is
// the one variable to flip once Cloudflare resolves it.
//
// Never on for preview: that Worker is editor-only and carries no /cdn route.
const proxyImages = !preview && process.env.PROXY_IMAGES === '1'

// The endpoint that only makes sense on the preview Worker. It lives
// outside src/pages because everything under it is prerendered in the static
// build: guarded with `prerender = !PREVIEW` it still emitted its own 404 body
// to dist/api/draft-mode/enable, and Cloudflare's asset router serves an
// existing file with HTTP 200 — so the public site answered 200 on a route that
// claimed to be absent. Injecting it keeps it out of that build entirely, which
// also lets it drop its own PREVIEW guard.
const previewRoutes = {
  name: 'preview-routes',
  hooks: {
    'astro:config:setup': ({injectRoute}) => {
      injectRoute({
        pattern: '/api/draft-mode/enable',
        entrypoint: './src/preview-routes/draft-mode-enable.ts',
      })
    },
  },
}

export default defineConfig({
  // The preview Worker runs on workers.dev, not on the zone: a Worker on a
  // custom domain in the softmess.de zone cannot reach api.sanity.io at all
  // (HTTP 525 on every subrequest — docs/CF-525-EVIDENCE.md). workers.dev is
  // not on the zone and is unaffected.
  site: preview ? 'https://softmess-preview.9dev.workers.dev' : 'https://softmess.de',
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
  integrations: preview ? [react(), previewRoutes] : [],
  vite: {
    plugins: [tailwindcss()],
    // Inlined at build time so `if (import.meta.env.PREVIEW)` branches are
    // eliminated entirely from the static bundle, imports included.
    define: {
      'import.meta.env.PREVIEW': JSON.stringify(preview),
      'import.meta.env.PROXY_IMAGES': JSON.stringify(proxyImages),
    },
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
