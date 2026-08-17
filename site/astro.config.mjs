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
  output: preview ? 'server' : 'static',
  adapter: preview ? cloudflare() : undefined,
  // React exists only to host the visual-editing overlay island. Registering
  // the renderer only in preview mode is what keeps it out of the public build.
  integrations: preview ? [react()] : [],
  vite: {
    plugins: [tailwindcss()],
    // Inlined at build time so `if (import.meta.env.PREVIEW)` branches are
    // eliminated entirely from the static bundle, imports included.
    define: {'import.meta.env.PREVIEW': JSON.stringify(preview)},
    // Pre-bundle the visual-editing island's chain: react/compiler-runtime is
    // CommonJS, and served raw it has no named export `c` to import.
    optimizeDeps: preview
      ? {
          include: [
            'react/compiler-runtime',
            '@sanity/visual-editing',
            '@sanity/visual-editing/react',
          ],
        }
      : undefined,
  },
})
