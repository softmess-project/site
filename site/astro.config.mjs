import {defineConfig} from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import {loadEnv} from 'vite'

// Load the repo-root .env / .env.local into process.env without clobbering
// anything CI already set.
const fileEnv = loadEnv(process.env.NODE_ENV ?? 'development', '..', '')
for (const [key, value] of Object.entries(fileEnv)) {
  process.env[key] ??= value
}

export default defineConfig({
  site: 'https://softmess.de',
  trailingSlash: 'never',
  vite: {plugins: [tailwindcss()]},
})
