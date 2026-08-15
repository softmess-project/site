import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  api: {
    projectId: '85i3osnk',
    dataset: 'production',
  },
  deployment: {
    // We self-host the Studio on Cloudflare and redeploy it from CI on every
    // push. Auto-updates would swap that deterministic bundle for a runtime
    // import map pointing at Sanity's CDN, gaining nothing.
    autoUpdates: false,
  },
  typegen: {
    enabled: true,
    path: '../site/src/**/*.{ts,astro}',
    schema: 'schema.json',
    generates: '../site/src/sanity.types.ts',
  },
})
