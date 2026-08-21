import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  api: {
    projectId: '85i3osnk',
    dataset: 'production',
  },
  deployment: {
    appId: 'owg684phbh0qnz6fltlf4mt4',

    // We self-host the Studio on Cloudflare and redeploy it from CI on every
    // push. Auto-updates would swap that deterministic bundle for a runtime
    // import map pointing at Sanity's CDN, gaining nothing.
    autoUpdates: false,
  },
  typegen: {
    formatGeneratedCode: true,
    enabled: true,
    // The dev server's typegen watcher and `sanity typegen generate` disagreed:
    // only the latter emitted the "Query TypeMap" module augmentation, so with
    // `pnpm dev` running the watcher kept reverting the committed file and
    // `pnpm verify`'s generated-types check failed at random. content.ts casts
    // every client.fetch() against the exported *_QUERY_RESULT types and never
    // relies on that augmentation, so switching it off costs no type safety and
    // makes both writers produce the same file.
    overloadClientMethods: false,
    // TypeScript only. Every query is defined with `defineQuery` in
    // site/src/lib/content.ts, and .astro files contain none — but the type
    // extractor's Babel parser rejects Astro's valid top-level frontmatter
    // `return` ([slug].astro), so scanning them only ever produced a
    // "Encountered errors in 1 file" warning a maintainer would misread as a
    // failure. Add .astro back if a query is ever defined in one.
    path: '../site/src/**/*.ts',
    schema: 'schema.json',
    generates: '../site/src/sanity.types.ts',
  },
  server: {
    hostname: '0.0.0.0',
    port: 3333,
  },
})
