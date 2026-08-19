# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install
pnpm dev                 # studio :3333 + site :4321 (site in PREVIEW mode)
pnpm verify              # the gate: typegen drift, studio lint/typecheck/tests, astro check, site tests
pnpm verify:live         # deployed-host assertions (LIVE=1); SITE_URL=… also checks the public site
pnpm build:site          # static build from live Sanity (needs SANITY_API_TOKEN)
pnpm build:site:deploy   # that build + the real-content gate (test/dist.test.ts with DIST_DIR=dist)
pnpm typegen             # regenerate site/src/sanity.types.ts from the Studio schema
```

Single test file / single test:

```bash
pnpm --filter site exec vitest run test/worker.test.ts
pnpm --filter site exec vitest run -t 'name of the test'
pnpm --filter studio exec vitest run lib/slugify.test.ts
```

Site tests need the fixture build first (`pnpm --filter site test` does both):
`PROXY_IMAGES=1 pnpm --filter site build:fixtures` then `PROXY_IMAGES=1 vitest run`.

**Never run `pnpm verify` while `pnpm dev` is running.** The Studio's typegen
watcher rewrites `site/src/sanity.types.ts` underneath it and the drift check
fails spuriously.

Secrets live in `.env.local` (gitignored); `.env` holds only `SANITY_PROJECT_ID`
and `SANITY_DATASET`. `astro.config.mjs` loads both from the repo root into
`process.env` without clobbering anything CI already set.

## Architecture

pnpm workspace, two packages: `site/` (Astro) and `studio/` (Sanity Studio).
Content lives in Sanity project `85i3osnk`, dataset `production`.

### One Astro project, two builds

`PREVIEW` decides which, and it is inlined at build time via
`vite.define`, so the losing branch is eliminated from the bundle entirely:

| | static (`PREVIEW` unset) | preview (`PREVIEW=1`) |
| --- | --- | --- |
| output | `static` → `dist/` | `server` → `dist/server` + `dist/client` |
| Worker | `softmess` on softmess.de | `softmess-preview` on workers.dev |
| perspective | `published` | `drafts` + stega source maps |
| JavaScript | none at all | React island for the visual-editing overlay |
| wrangler config | `wrangler.jsonc` | `wrangler.preview.jsonc` |

The public site ships **no client JavaScript and no third-party subresource** —
`test/dist.test.ts` enforces both. Fonts are self-hosted via `@fontsource/*`
because the privacy policy promises it.

### Three Workers

- `softmess` — static assets on softmess.de. `src/worker.ts` runs only for
  `/cdn/*` (`run_worker_first`), proxying Sanity's image CDN same-origin so
  visitor IPs never reach Sanity. Currently **dormant**: gated on `PROXY_IMAGES`,
  off by default — see the zone constraint below.
- `softmess-preview` — SSR preview behind the Studio's Presentation mode.
- `softmess-studio` — the built Studio on studio.softmess.de.

### The zone constraint (read before touching deploy config)

Every Worker on a custom domain in the `softmess.de` zone gets **HTTP 525** on
outbound TLS to `api.sanity.io`, `cdn.sanity.io` and `github.com`. The same code
on `workers.dev` reaches all of them. This is why the preview Worker lives on
`softmess-preview.9dev.workers.dev` and why the image proxy ships behind an
off-by-default flag. Full investigation and everything already ruled out:
`docs/BACKLOG.md` §1.1. Do not "fix" this in code.

Because Cloudflare Access cannot bind to workers.dev, the draft-mode cookie
carries `PREVIEW_DRAFT_SECRET` rather than a bare `1`, compared in constant time
(`site/src/lib/draft.ts`). It fails closed.

### Deploy

Push to `main` runs `verify.yml`. `deploy.yml` runs on `workflow_dispatch`
(target: all/site/preview/studio) and on a `sanity-publish` `repository_dispatch`
fired by Sanity's publish webhook, which rebuilds the static site only.

The two `wrangler deploy` invocations have **opposite** `--config` rules, and both
are load-bearing:

- static site: `wrangler deploy --config wrangler.jsonc` — required, or wrangler
  follows a stale `.wrangler/deploy/config.json` left by a preview build and
  deploys the SSR app to the production domain.
- preview: plain `wrangler deploy` — passing `--config wrangler.preview.jsonc`
  uploads `entry.mjs` without its chunks; it deploys cleanly, then 404s every route.

### Data flow and types

Every GROQ query is a `defineQuery` const in `site/src/lib/content.ts` — never in
`.astro` frontmatter (TypeGen's Babel parser rejects Astro's top-level `return`,
so `sanity.cli.ts` scans `../site/src/**/*.ts` only). Getters take a
`SanityClient` argument; pages read theirs from `Astro.locals.sanity`, which
`src/middleware.ts` sets to the draft or published client per request.

TypeGen runs from `studio/` and writes `site/src/sanity.types.ts`, which is
**committed**; `pnpm verify` regenerates and fails on any diff. `overloadClientMethods`
is off, so `content.ts` casts each `client.fetch()` against the exported
`*_QUERY_RESULT` types explicitly.

`SANITY_FIXTURES=1` swaps every getter to `site/test/fixtures/*.json`, which is
how the offline test build runs without a token.

`getStaticPaths()` is hoisted into its own module context by Astro — it must
`await import()` what it needs rather than closing over module scope.

### Content model

Singletons `siteSettings` and `homePage` (fixed `_id`, fetched by `_id`, delete
and duplicate actions stripped — `studio/lib/singletons.ts`), plus `page`
documents. Everything renders through `pageBuilder`: an array of `hero`,
`richText`, `imageText`, `gallery`, `cta` blocks, dispatched by `_type` in
`site/src/components/PageBuilder.astro`. The first block owns the `h1`;
subsequent ones start at `h2` — heading level is never stored in content.

Adding a block type means: `studio/schemaTypes/blocks/<name>.ts` →
`schemaTypes/index.ts` → the `pageBuilder` array → `PAGE_BUILDER_PROJECTION` in
`content.ts` (project `_key` and `_type` on every member — stega needs `_key`) →
a component → the `switch` in `PageBuilder.astro` → `pnpm typegen`.

Block prop types are derived from the generated query result via
`site/src/lib/blocks.ts` (`BlockOfType<'hero'>`), never hand-written, so schema
drift is a type error rather than a blank section.

### Styling

Tailwind v4, CSS-first config in `site/src/styles/theme.css`. `--spacing: 4.4px`
maps Tailwind's numeric scale onto the design kit's steps, so use `p-4`/`gap-6`
rather than arbitrary values, and the semantic color names (`bg-bg`, `text-ink`,
`bg-accent`). Variant strings from Sanity go through `pick()` in
`site/src/lib/variants.ts`, which `stegaClean`s before comparing — **never**
`stegaClean` Portable Text, it destroys the overlay markers.

## Conventions

- Prettier: no semicolons, single quotes, no bracket spacing, 100 cols.
- **All editor-facing strings are German** — schema titles, descriptions,
  validation messages, build-failure messages. Code and comments are English.
- Comments here explain *why*, usually recording a failure that was actually
  observed. They are expensive knowledge; don't delete them while editing
  nearby code.
- `docs/BACKLOG.md` is the live status of what's blocked, answered, and
  deliberately not being done. Check it before proposing infrastructure work.
