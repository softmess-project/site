# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install
pnpm dev                 # studio :3333 + site :4321 (site in PREVIEW mode)
pnpm verify              # the gate: typegen drift, lint both packages, studio typecheck/tests, astro check, site tests
pnpm verify:live         # deployed-host assertions (LIVE=1), verbose so skips are named
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

`verify:live` skips whatever it lacks credentials for and reports what it skipped
— read the `↓` lines, not just the exit code. `vitest.config.ts` loads the
repo-root `.env`/`.env.local` **only when `LIVE=1`**, so the token is there for
the live gate and absent from the offline run, which must stay unable to reach
Sanity. Its nine public-site assertions need `SITE_URL` pointing at an origin
that serves the real static build; `softmess.de` is behind Cloudflare Access, so
serve it locally:

```bash
pnpm build:site
cd site && npx wrangler dev --config wrangler.jsonc --port 8787
SITE_URL=http://localhost:8787 pnpm verify:live   # 18 passed | 3 skipped
```

**Never run `pnpm verify` while `pnpm dev` is running.** The Studio's typegen
watcher rewrites `site/src/sanity.types.ts` underneath it and the drift check
fails spuriously.

Two git hooks, installed by the root `prepare` script via `simple-git-hooks`
(its own postinstall is refused in `pnpm-workspace.yaml` — `prepare` runs the
same binary, and a dependency that writes to `.git` on install is worth
refusing):

- **pre-commit** — `lint-staged` runs `prettier --write` over staged files and
  re-stages them. Sub-second, and it fixes rather than complains.
- **pre-push** — `scripts/pre-push.sh` runs the whole `pnpm verify` gate (~23s).
  On commit it would be slow enough to get bypassed by reflex, and a hook people
  bypass by reflex is worse than none. If it fails because `pnpm dev` is running,
  the caveat above is why; `git push --no-verify` overrides.

Secrets live in `.env.local` (gitignored); `.env` holds only `SANITY_PROJECT_ID`
and `SANITY_DATASET`. `astro.config.mjs` loads both from the repo root into
`process.env` without clobbering anything CI already set.

## Architecture

pnpm workspace, two packages: `site/` (Astro) and `studio/` (Sanity Studio).
Content lives in Sanity project `85i3osnk`, dataset `production`.

### One Astro project, two builds

`PREVIEW` decides which, and it is inlined at build time via
`vite.define`, so the losing branch is eliminated from the bundle entirely:

|                 | static (`PREVIEW` unset)  | preview (`PREVIEW=1`)                       |
| --------------- | ------------------------- | ------------------------------------------- |
| output          | `static` → `dist/`        | `server` → `dist/server` + `dist/client`    |
| Worker          | `softmess` on softmess.de | `softmess-preview` on workers.dev           |
| perspective     | `published`               | `drafts` + stega source maps                |
| JavaScript      | none at all               | React island for the visual-editing overlay |
| wrangler config | `wrangler.jsonc`          | `wrangler.preview.jsonc`                    |

The public site ships **no client JavaScript and no third-party subresource** —
`test/dist.test.ts` enforces both. Fonts are self-hosted via `@fontsource/*`
because the privacy policy promises it.

Because so little actually reaches a visitor, the CycloneDX SBOM at
`src/pages/.well-known/sbom.ts` (the URI RFC 9472 registers) lists those font
packages by hand as `SHIPPED`, with the build toolchain in `metadata.tools`.
**Adding anything that ships bytes to the browser means adding it to `SHIPPED`** —
`dist.test.ts` compares that list against `Base.astro`'s own imports in both
directions, and validates the output against CycloneDX's published schema.
`public/_headers` is what types the response: the path has no extension, so
Cloudflare's asset router has nothing to infer from.

### Three Workers

- `softmess` — static assets on softmess.de. `src/worker.ts` runs for exactly
  two paths (`run_worker_first`), and every other URL is served from assets
  without invoking it:
  - `/cdn/*` proxies Sanity's image CDN same-origin so visitor IPs never reach
    Sanity. Currently **dormant**: gated on `PROXY_IMAGES`, off by default — see
    the zone constraint below.
  - `/.well-known/webfinger` answers RFC 7033 queries. It needs code because the
    answer depends on `?resource=` and the asset router discards the query
    string, so a static file would reply `200` to a resource that is not ours
    where the RFC demands `404`. The Worker holds **no identifier**: the JRDs are
    built from Sanity by `src/pages/.well-known/webfinger.ts` and read back
    through the `ASSETS` binding, which reaches the asset store directly rather
    than re-entering this rule. Adding a subject means editing that endpoint and
    nothing else.
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
subsequent ones start at `h2` — heading level is never stored in content. Only
`gallery` renders no heading, so `pageBuilder` warns when it is placed first.

Every link — a block's `actions`, both nav arrays, a rich-text annotation — is
one of two types built from the same `linkFields`: `action` (target + label) or
`link` (target only, because the marked-up text is the label). A `linkType`
discriminant, not "whichever field is set", decides between the `page`
reference and the `href`; switching a link hides the losing field but does not
clear it. GROQ collapses both branches to `{label, href}` before the components
see them, so nothing downstream knows internal and external links are stored
differently. `LINK_FILTER` in `content.ts` drops links whose target does not
resolve, which is what keeps `<a href="/null">` off the published site.

`seo` is one shared object type on `siteSettings` (the site-wide default),
`homePage` and `page`. `og:image` falls through from the page to the site
default in `Base.astro`, and must stay absolute.

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

- ESLint runs over both packages and `pnpm verify` fails on any warning
  (`--max-warnings 0`). `studio/eslint.config.mjs` is `@sanity/eslint-config-studio`;
  `site/eslint.config.mjs` is flat config with typescript-eslint plus
  `eslint-plugin-astro`, which is what makes `.astro` files lintable at all —
  without its parser they are unparseable, not merely unchecked. The
  `eslint-sarif` job in `verify.yml` re-runs both and uploads the findings to
  code scanning through `scripts/eslint-sarif.mjs`; that is reporting only,
  since the gate has already failed by then. The two packages sit on different
  eslint majors on purpose — site on 10, studio pinned to 9 — and TypeScript is
  held at 6.0.3 rather than 7. Both are upstream blocks, recorded with the
  observed failures in `docs/BACKLOG.md` §4.5.
- Prettier: no semicolons, single quotes, no bracket spacing, 100 cols. One
  config, `.prettierrc.json` at the root, and `pnpm verify` fails on any drift —
  `pnpm format` fixes it. `.astro` needs `prettier-plugin-astro`, which the
  config loads. `.prettierignore` excludes build output, the generated
  `sanity.types.ts` (typegen already formats it, and verify fails on any diff in
  it, so a second writer could deadlock), and `.superpowers/`/`docs/superpowers/`
  session artifacts.
- `*.jsonc` is pinned to `trailingComma: "none"`. Prettier's default adds them,
  wrangler tolerates them, and `dist.test.ts` parses `wrangler.jsonc` with strict
  `JSON.parse` after stripping comments — so the deploy config stays inside
  strict JSON.
- **All editor-facing strings are German** — schema titles, descriptions,
  validation messages, build-failure messages. Code and comments are English.
- Comments here explain _why_, usually recording a failure that was actually
  observed. They are expensive knowledge; don't delete them while editing
  nearby code.
- `docs/BACKLOG.md` is the live status of what's blocked, answered, and
  deliberately not being done. Check it before proposing infrastructure work.
