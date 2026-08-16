# Sanity Page Builder & Live Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the site's owner a working live preview (Sanity Presentation mode against a real SSR preview deployment) and a page builder she can use without a developer, on the existing Astro site.

**Architecture:** One Astro project with two build modes selected by a `PREVIEW=1` environment variable. `PREVIEW` unset builds a fully static site with zero client JavaScript, deployed to `softmess.de`. `PREVIEW=1` builds an SSR Worker on `@astrojs/cloudflare`, deployed to `preview.softmess.de`, which reads drafts, embeds stega source maps, and loads the visual-editing overlay — gated behind a draft-mode cookie so it never serves drafts to an anonymous visitor. The Sanity Studio on `studio.softmess.de` runs the Presentation tool pointed at the preview origin. Content becomes a `pageBuilder[]` array of five block objects rendered by `.astro` components.

**Tech Stack:** Astro 7.2.2, `@sanity/astro` 3.5.0 (visual editing only), `@astrojs/cloudflare` 14.2.1, `@astrojs/react` 6.0.2, `@sanity/client` 8 (`/stega` entrypoint), `@sanity/preview-url-secret` 4.1.4, Sanity Studio 6.9.2, `@sanity/locale-de-de` 1.1.36, Tailwind 4, vitest + linkedom, pnpm 11.9.0 workspace, Cloudflare Workers (static assets + one SSR Worker).

**Spec:** `docs/superpowers/specs/2026-08-16-page-builder-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **The static public build ships zero client-side JavaScript.** `site/test/dist.test.ts` asserts `querySelectorAll('script')` is empty for every page. This assertion is scoped to the static build output (`dist/` and `dist-fixtures/`) and must never be run against the preview build, which legitimately loads the overlay.
- **The only third-party origin on a public page is `cdn.sanity.io`.** Asserted by the existing subresource test.
- **The preview hostname must be absent from every static build artifact.**
- **Schema field names stay English.** Everything the owner sees — `title`, `description`, validation messages, structure list titles — is German. The bar is "nothing she routinely touches is in English", not "no English exists anywhere".
- **`stegaClean` every string that is compared or mapped to a CSS class.** Never apply it to Portable Text wholesale — that strips overlay markers.
- **Heading levels are never stored in content.** `PageBuilder.astro` passes `semanticLevel`: `h1` for the first block, `h2` for every block after it.
- **`_key` is the render key. Never an array index.**
- **`produkte` is a forbidden page slug** from day one; products will live at `/produkte/<slug>`.
- **Five block types only:** `hero`, `richText`, `imageText`, `gallery`, `cta`.
- **Deployment is manual `wrangler deploy` throughout this plan.** The site is not live and not linked anywhere yet, so shipping intermediate states to the real hostnames is the intended fast feedback loop. CI automation and the publish webhook are deliberately out of scope — they are a follow-up plan, written once this workflow is proven by hand.
- **`pnpm verify` must pass before every commit.** It runs `typegen` + a git-diff check on `site/src/sanity.types.ts`, studio lint, `astro check`, and the vitest suites.
- **Regenerate types after every schema change:** `pnpm typegen` from the repo root. A schema change without regenerated types fails `pnpm verify`.
- Secrets live in `.env.local` (git-ignored). `.env` holds non-secrets only.

## Spec Amendments Established While Planning

These were verified against the installed packages and correct the spec. Fold them back into `docs/superpowers/specs/2026-08-16-page-builder-design.md` as part of Task 0.

1. **The visual-editing package is named.** Spec §5 says "Sanity's Astro integration" without naming it. It is `@sanity/astro@3.5.0`, imported as `import {VisualEditing} from '@sanity/astro/visual-editing'`. Its default `refresh` handler is literally `window.location.reload()` — confirming §5's accepted trade-off, from source.
2. **The preview build ships React; the static build does not.** `VisualEditing` renders `<VisualEditingComponent client:only="react" />`, so the preview build needs `@astrojs/react`, `react`, `react-dom`. This is new information: the spec's "no new framework" claim holds for the **public** build only. The `@astrojs/react` integration is registered only when `PREVIEW=1`, and the overlay import is dynamic behind a build-time-inlined constant, so the static build never sees React.
3. **`previewUrl.origin` is deprecated** in `sanity@6.9.2` — use `previewUrl.initial`. `allowOrigins` is a top-level `presentationTool` option, not a member of `previewUrl`.
4. **The draft-mode secret is not a hand-rolled shared secret.** Spec §7.2 says "validates a shared secret from the Studio"; a literal shared secret would ship inside the public Studio bundle. The correct mechanism is `@sanity/preview-url-secret`'s `validatePreviewUrl(client, url)`, which validates a rotating `sanity.previewUrlSecret` document the Studio creates.
5. **The draft cookie must be `SameSite=None; Secure`.** The preview runs in an iframe on a different origin from the Studio; a `Lax` cookie is not sent in that context and the handshake silently fails.
6. **`getStaticPaths()` is safely ignored in server output.** Verified in `astro/dist/core/render/route-cache.js:20` — non-prerendered routes skip it entirely. So `[slug].astro` can keep its `getStaticPaths` export and work in both build modes with no branching.

---

## Task 0: Close the spec review

**Files:**
- Modify: `docs/superpowers/specs/2026-08-16-page-builder-design.md`
- Modify: `studio/wrangler.jsonc`

- [ ] **Step 1: Fold the six amendments above into the spec**

Add them to the relevant sections: 1, 2 and 6 into §5 and §4; 3 into §5's code block; 4 and 5 into §7.2. Change the status line from `Status: approved pending spec review` to `Status: approved`.

- [ ] **Step 2: Decide on the stray `studio/wrangler.jsonc` change**

The working tree adds trailing commas to `studio/wrangler.jsonc`. JSONC permits them and it is a formatter artifact, not a functional change. Keep it — it costs nothing and reverting creates churn.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-16-page-builder-design.md studio/wrangler.jsonc
git commit -m "docs: close spec review; name the Astro visual-editing stack"
```

---

## Task 1: Two build modes and the preview Worker

Stand up `preview.softmess.de` as a real SSR Worker before any schema work, so every later task can be verified against the real thing. At the end of this task the preview hostname serves the site exactly as production does — published content, no drafts, no overlay.

> **Status: Steps 1–6 and 10 are done (commit `d6d1ebe`). Steps 7–9 are DEFERRED and still
> outstanding.** The Cloudflare API token in `.env.local` carries Zone:Read but no Workers
> permission — `/accounts/{id}/workers/scripts` returns error 10000 while `/zones` succeeds.
> It is an account-owned token, so `/user/tokens/verify` returns "Invalid API Token" for it
> regardless and is not a usable liveness check. **To unblock, add to that token in the
> Cloudflare dashboard: Account → Workers Scripts → Edit; Account → Workers Routes → Edit;
> Zone → Workers Routes → Edit on `softmess.de`.** Then run Steps 7–9 below as written.
>
> Two corrections were made to this task while implementing it, both verified against the
> installed adapter: `@astrojs/cloudflare@14.2.1` emits `dist/server/entry.mjs` and
> `dist/client/`, **not** `dist/_worker.js/index.js` and `dist/`. `site/wrangler.preview.jsonc`
> as committed reflects the real layout; the Step 5 code block below does not. Trust the
> committed file.
>
> Nothing else in this plan depends on the deploy: spec §5.1 supports pointing
> `previewUrl.initial` at `http://localhost:4321`, so Tasks 2 and 3 — including the full
> click-to-edit verification — run locally with no Worker.

**Files:**
- Modify: `site/astro.config.mjs`
- Create: `site/wrangler.preview.jsonc`
- Modify: `site/package.json` (deps + scripts)
- Modify: `pnpm-workspace.yaml` (peer dependency rules)
- Modify: `site/tsconfig.json`

**Interfaces:**
- Produces: a build-time constant `import.meta.env.PREVIEW` (boolean, inlined by Vite) that every later task branches on; `pnpm --filter site build:preview`; a deployed Worker at `preview.softmess.de`.

- [ ] **Step 1: Install the preview-only dependencies**

```bash
pnpm --filter site add @sanity/astro@3.5.0 @sanity/preview-url-secret@4.1.4
pnpm --filter site add -D @astrojs/cloudflare@14.2.1 @astrojs/react@6.0.2 react@^19.2.8 react-dom@^19.2.8 @types/react@^19.2.18 @types/react-dom@^19.2.0
```

- [ ] **Step 2: Silence the known peer-dependency warnings**

`@sanity/astro@3.5.0` declares a peer on `@sanity/client@^7.14.1` and `@sanity/preview-url-secret@4.1.4` on `^7.26.2`, while the site is on `@sanity/client@8`. Neither package's visual-editing or secret-validation code paths touch the client's changed surface. `@sanity/astro` also peer-declares `sanity`, `styled-components` and `react-is`, which are only needed for its embedded-Studio route — a route this project does not use, because the Studio is deployed separately.

Add to `pnpm-workspace.yaml`, after the `packages:` block:

```yaml
peerDependencyRules:
  allowedVersions:
    '@sanity/astro>@sanity/client': '8'
    '@sanity/preview-url-secret>@sanity/client': '8'
  ignoreMissing:
    - sanity
    - styled-components
    - react-is
```

- [ ] **Step 3: Add the two build modes to `site/astro.config.mjs`**

```javascript
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
  },
})
```

- [ ] **Step 4: Add the preview build script**

In `site/package.json` `scripts`, after `"build"`:

```json
"build:preview": "PREVIEW=1 astro build",
```

- [ ] **Step 5: Create `site/wrangler.preview.jsonc`**

`nodejs_compat` is required: it is what populates `process.env` from Worker secrets at runtime, which is how the Sanity token reaches the SSR code.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "softmess-preview",
  "main": "./dist/_worker.js/index.js",
  "compatibility_date": "2026-08-15",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
  },
  "routes": [{"pattern": "preview.softmess.de", "custom_domain": true}],
}
```

- [ ] **Step 6: Verify the static build is unchanged**

Run: `pnpm verify`
Expected: PASS — in particular `site/test/dist.test.ts` "ships no JavaScript" still passes, proving the React renderer did not leak into the static output.

- [ ] **Step 7: Build and deploy the preview Worker by hand**

```bash
pnpm --filter site build:preview
pnpm --filter site exec wrangler deploy --config wrangler.preview.jsonc
pnpm --filter site exec wrangler secret put SANITY_API_TOKEN --config wrangler.preview.jsonc
pnpm --filter site exec wrangler secret put SANITY_PROJECT_ID --config wrangler.preview.jsonc
pnpm --filter site exec wrangler secret put SANITY_DATASET --config wrangler.preview.jsonc
```

If `preview.softmess.de` has no DNS record yet, `wrangler deploy` will offer to create the custom domain; accept it.

- [ ] **Step 8: Verify the preview Worker serves the site**

Run: `curl -sS -o /dev/null -w '%{http_code}\n' https://preview.softmess.de/` then `curl -sS https://preview.softmess.de/ | grep -c 'follow the white rabbit'`
Expected: `200`, and a count of `1` — the Worker renders on demand from live Sanity content.

- [ ] **Step 9: Deploy the static site and the Studio too, to prove all three Workers**

```bash
pnpm build:site
pnpm --filter site exec wrangler deploy
pnpm build:studio
pnpm --filter studio exec wrangler deploy
```

Verify `https://softmess.de/` and `https://studio.softmess.de/` both return 200.

- [ ] **Step 10: Commit**

```bash
git add site/astro.config.mjs site/wrangler.preview.jsonc site/package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(site): add PREVIEW build mode and the preview Worker"
```

---

## Task 2: Draft mode — the handshake, the cookie, and the per-request client

The preview Worker currently serves published content to anyone. This task makes it serve **drafts with stega source maps** to a holder of a valid draft cookie, and published content to everyone else. That asymmetry is the one failure mode in this design that leaks content rather than merely breaking, so it gets a test.

**Files:**
- Modify: `site/src/lib/sanity.ts`
- Create: `site/src/lib/draft.ts`
- Create: `site/src/middleware.ts`
- Create: `site/src/env.d.ts`
- Create: `site/src/pages/api/draft-mode/enable.ts`
- Modify: `site/src/lib/content.ts` (getters take an explicit client)
- Modify: `site/src/pages/index.astro`, `site/src/pages/[slug].astro`, `site/src/pages/404.astro`, `site/src/layouts/Base.astro` (pass `Astro.locals.sanity`)
- Test: `site/test/draft.test.ts`

**Interfaces:**
- Consumes: `import.meta.env.PREVIEW` from Task 1.
- Produces:
  - `DRAFT_COOKIE: 'sanity-draft-mode'` and `isDraftMode(cookies: AstroCookies): boolean` from `src/lib/draft.ts`
  - `publishedClient: SanityClient` and `draftClient(): SanityClient` from `src/lib/sanity.ts`
  - `App.Locals.sanity: SanityClient` and `App.Locals.draft: boolean`
  - every `src/lib/content.ts` getter takes a `SanityClient` as its **first** parameter: `getSiteSettings(client)`, `getHomePage(client)`, `getLegalPageSlugs(client)`, `getLegalPage(client, slug)`, `getLegalPageNav(client)`

- [ ] **Step 1: Write the failing test**

Create `site/test/draft.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {publishedClient, draftClient} from '../src/lib/sanity'

describe('preview clients', () => {
  it('never asks for drafts on the published client', () => {
    expect(publishedClient.config().perspective).toBe('published')
  })

  it('does not encode stega on the published client', () => {
    // Stega characters in the static build would ship invisible junk to every
    // visitor and break the no-third-party-origin guarantees around SEO tags.
    expect(publishedClient.config().stega?.enabled).toBeFalsy()
  })

  it('asks for drafts and encodes stega on the draft client', () => {
    const client = draftClient()
    expect(client.config().perspective).toBe('drafts')
    expect(client.config().stega?.enabled).toBe(true)
    expect(client.config().stega?.studioUrl).toContain('studio')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter site exec vitest run test/draft.test.ts`
Expected: FAIL — `publishedClient` and `draftClient` are not exported from `src/lib/sanity.ts`.

- [ ] **Step 3: Rewrite `site/src/lib/sanity.ts`**

```ts
import {createClient, type SanityClient} from '@sanity/client/stega'

const base = {
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET!,
  apiVersion: '2026-08-15',
  useCdn: false,
  token: process.env.SANITY_API_TOKEN,
}

/** Published content, no source maps. The static build's only client. */
export const publishedClient: SanityClient = createClient({
  ...base,
  perspective: 'published',
})

/** Drafts plus stega source maps, for click-to-edit overlays. Preview only.
 *  Created per request rather than once, so a request without the draft cookie
 *  can never accidentally reuse a drafts-perspective client. */
export function draftClient(): SanityClient {
  return createClient({
    ...base,
    perspective: 'drafts',
    stega: {
      enabled: true,
      studioUrl: process.env.SANITY_STUDIO_URL ?? 'https://studio.softmess.de',
    },
  })
}

/** @deprecated Kept so `content.ts` callers migrate in one place. */
export const client = publishedClient
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter site exec vitest run test/draft.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `site/src/lib/draft.ts`**

```ts
import type {AstroCookies} from 'astro'

export const DRAFT_COOKIE = 'sanity-draft-mode'

/** Draft mode exists only on the preview deployment. On the static build the
 *  constant folds to `false` and this whole branch is eliminated. */
export function isDraftMode(cookies: AstroCookies): boolean {
  if (!import.meta.env.PREVIEW) return false
  return cookies.get(DRAFT_COOKIE)?.value === '1'
}
```

- [ ] **Step 6: Create `site/src/env.d.ts`**

```ts
import type {SanityClient} from '@sanity/client/stega'

declare global {
  namespace App {
    interface Locals {
      /** The client for this request: drafts + stega, or published. */
      sanity: SanityClient
      /** True when this request holds a valid draft-mode cookie. */
      draft: boolean
    }
  }
}

export {}
```

- [ ] **Step 7: Create `site/src/middleware.ts`**

Middleware runs during static prerendering as well as on demand, so both build modes get a client on `locals` through one code path.

```ts
import type {MiddlewareHandler} from 'astro'
import {draftClient, publishedClient} from './lib/sanity'
import {isDraftMode} from './lib/draft'

export const onRequest: MiddlewareHandler = (context, next) => {
  const draft = isDraftMode(context.cookies)
  context.locals.draft = draft
  context.locals.sanity = draft ? draftClient() : publishedClient
  return next()
}
```

- [ ] **Step 8: Create the draft-mode handshake route**

Create `site/src/pages/api/draft-mode/enable.ts`. `validatePreviewUrl` checks the rotating `sanity.previewUrlSecret` document the Studio creates — no secret is baked into the Studio bundle.

```ts
import type {APIRoute} from 'astro'
import {validatePreviewUrl} from '@sanity/preview-url-secret'
import {publishedClient} from '../../../lib/sanity'
import {DRAFT_COOKIE} from '../../../lib/draft'

export const prerender = false

export const GET: APIRoute = async ({request, cookies, redirect}) => {
  const {isValid, redirectTo = '/'} = await validatePreviewUrl(publishedClient, request.url)

  if (!isValid) {
    return new Response('Ungültiges oder abgelaufenes Vorschau-Secret', {status: 401})
  }

  cookies.set(DRAFT_COOKIE, '1', {
    path: '/',
    httpOnly: true,
    // The preview renders inside an iframe on the Studio's origin. A Lax cookie
    // is not sent in that cross-site context and the handshake fails silently.
    sameSite: 'none',
    secure: true,
  })

  return redirect(redirectTo, 307)
}
```

- [ ] **Step 9: Thread the client through `content.ts`**

In `site/src/lib/content.ts`, replace the `import {client} from './sanity'` line with `import type {SanityClient} from '@sanity/client/stega'`, and give every getter the client as its first parameter. The fixture branches are unchanged — they return before any client is used.

```ts
export async function getSiteSettings(client: SanityClient): Promise<SiteSettings> {
  if (USE_FIXTURES) return siteSettingsFixture as unknown as SiteSettings
  return (await client.fetch(SITE_SETTINGS_QUERY)) as SiteSettings
}

export async function getHomePage(client: SanityClient): Promise<HomePage> {
  if (USE_FIXTURES) return homePageFixture as unknown as HomePage
  return (await client.fetch(HOME_PAGE_QUERY)) as HomePage
}

export async function getLegalPageSlugs(client: SanityClient): Promise<string[]> {
  if (USE_FIXTURES) {
    return (legalPagesFixture as Array<{slug: {current: string}}>).map((p) => p.slug.current)
  }
  return (await client.fetch(LEGAL_PAGE_SLUGS_QUERY)) as string[]
}

export async function getLegalPage(
  client: SanityClient,
  slug: string,
): Promise<LegalPage | null> {
  if (USE_FIXTURES) {
    const match = (legalPagesFixture as Array<{slug: {current: string}}>).find(
      (page) => page.slug.current === slug,
    )
    if (!match) return null
    return {...match, slug: match.slug.current} as unknown as LegalPage
  }
  return ((await client.fetch(LEGAL_PAGE_QUERY, {slug})) as LegalPage) ?? null
}

export async function getLegalPageNav(
  client: SanityClient,
): Promise<Array<{title: string; slug: string}>> {
  if (USE_FIXTURES) {
    return (legalPagesFixture as Array<{title: string; slug: {current: string}}>)
      .map((page) => ({title: page.title, slug: page.slug.current}))
      .sort((a, b) => a.title.localeCompare(b.title))
  }
  return (await client.fetch(LEGAL_PAGE_NAV_QUERY)) as Array<{title: string; slug: string}>
}
```

- [ ] **Step 10: Update every call site**

`getStaticPaths()` runs outside request context and has no `locals`, so it imports `publishedClient` directly — correct, because the set of routes to prerender is a property of published content.

- `site/src/pages/index.astro`: `const [settings, home] = await Promise.all([getSiteSettings(Astro.locals.sanity), getHomePage(Astro.locals.sanity)])`
- `site/src/pages/[slug].astro`: inside `getStaticPaths`, `import {publishedClient} from '../lib/sanity'` and call `getLegalPageSlugs(publishedClient)`; in the frontmatter, pass `Astro.locals.sanity` to `getSiteSettings` and `getLegalPage`.
- `site/src/pages/404.astro`: pass `Astro.locals.sanity` to `getSiteSettings`.
- `site/src/layouts/Base.astro`: `const legalPages = await getLegalPageNav(Astro.locals.sanity)`.

- [ ] **Step 11: Fix the content tests for the new signature**

In `site/test/content.test.ts`, import `publishedClient` from `../src/lib/sanity` and pass it as the first argument to each getter call. Fixture mode short-circuits before the client is touched, so the assertions are unchanged.

- [ ] **Step 12: Run the full verification**

Run: `pnpm verify`
Expected: PASS. The static build still emits no `<script>`.

- [ ] **Step 13: Deploy and prove the leak test by hand**

```bash
pnpm --filter site build:preview
pnpm --filter site exec wrangler deploy --config wrangler.preview.jsonc
curl -sS https://preview.softmess.de/ -o /tmp/preview.html
node -e "const h=require('fs').readFileSync('/tmp/preview.html','utf8'); const re=new RegExp('[\\u200B-\\u200F\\uFEFF]{8,}'); console.log(re.test(h) ? 'FAIL: stega payload served without the draft cookie' : 'OK: published content only')"
```

Expected: `OK: published content only`. A stega payload is a long run of zero-width characters, so its presence on an anonymous request means the drafts perspective leaked. This is the failure mode that exposes unpublished content rather than merely breaking, so do not continue past a FAIL.

- [ ] **Step 14: Commit**

```bash
git add site/src site/test package.json pnpm-lock.yaml
git commit -m "feat(site): add draft-mode handshake and per-request Sanity client"
```

---

## Task 3: Presentation mode — overlays, locations, and the Studio wiring

This is the task that produces the thing the owner asked for: her content, in the real design, beside the form, click-to-edit. Everything up to here was scaffolding for it. Prove it works on the **current** content model before rebuilding the content model on top of it.

**Files:**
- Create: `studio/presentation/resolve.ts`
- Modify: `studio/sanity.config.ts`
- Modify: `site/src/layouts/Base.astro`
- Modify: `.env` (non-secret preview origin)

**Interfaces:**
- Consumes: `App.Locals.draft` from Task 2; the `/api/draft-mode/enable` route.
- Produces: `resolve` (a `PresentationPluginOptions['resolve']`) exported from `studio/presentation/resolve.ts`. Task 9 extends its `locations` map with the `page` type.

- [ ] **Step 1: Add the Sanity CORS origins**

Overlays fail with a console error and no UI signal when an origin is missing from the allowlist. All four are needed: two deployed, two local.

```bash
pnpm --filter studio exec sanity cors add https://preview.softmess.de --credentials
pnpm --filter studio exec sanity cors add https://studio.softmess.de --credentials
pnpm --filter studio exec sanity cors add http://localhost:4321 --credentials
pnpm --filter studio exec sanity cors add http://localhost:3333 --credentials
```

- [ ] **Step 2: Create `studio/presentation/resolve.ts`**

```ts
import {defineLocations, type PresentationPluginOptions} from 'sanity/presentation'

export const resolve: PresentationPluginOptions['resolve'] = {
  locations: {
    homePage: defineLocations({
      resolve: () => ({locations: [{title: 'Startseite', href: '/'}]}),
    }),
    legalPage: defineLocations({
      select: {title: 'title', slug: 'slug.current'},
      resolve: (doc) => ({
        locations: [{title: doc?.title || 'Ohne Titel', href: `/${doc?.slug}`}],
      }),
    }),
    // Editing the brand or the footer changes every page, so say so rather
    // than resolving to a single arbitrary one.
    siteSettings: defineLocations({
      resolve: () => ({locations: [{title: 'Jede Seite', href: '/'}]}),
    }),
  },
}
```

- [ ] **Step 3: Wire the Presentation tool into `studio/sanity.config.ts`**

`initial` replaces the deprecated `origin`; `allowOrigins` is a top-level option, not part of `previewUrl`.

```ts
import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {presentationTool} from 'sanity/presentation'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'
import {structure} from './structure'
import {resolve} from './presentation/resolve'

// Local development points the preview at `pnpm dev`, so the whole editing
// experience runs on a laptop without touching the deployed Worker.
const previewOrigin =
  process.env.SANITY_STUDIO_PREVIEW_ORIGIN ?? 'https://preview.softmess.de'

export default defineConfig({
  name: 'default',
  title: 'Softmess',

  projectId: '85i3osnk',
  dataset: 'production',

  plugins: [
    structureTool({structure}),
    presentationTool({
      resolve,
      allowOrigins: ['https://preview.softmess.de', 'http://localhost:4321'],
      previewUrl: {
        initial: previewOrigin,
        previewMode: {enable: '/api/draft-mode/enable'},
      },
    }),
    visionTool(),
  ],

  schema: {
    types: schemaTypes,
    templates: (templates) =>
      templates.filter(({schemaType}) => !['siteSettings', 'homePage'].includes(schemaType)),
  },
})
```

- [ ] **Step 4: Load the overlay in `site/src/layouts/Base.astro`**

Two layers keep React out of the public build: the `@astrojs/react` renderer is only registered when `PREVIEW=1` (Task 1), and this import is dynamic behind a constant Vite inlines to `false`, so the whole branch — import included — is eliminated from the static bundle.

Add to the frontmatter, after the existing imports:

```ts
const {VisualEditing} = import.meta.env.PREVIEW
  ? await import('@sanity/astro/visual-editing')
  : {VisualEditing: null}
```

And immediately before `</body>`:

```astro
    {VisualEditing && <VisualEditing enabled={Astro.locals.draft} />}
```

- [ ] **Step 5: Verify the static build still ships no JavaScript**

Run: `pnpm verify`
Expected: PASS — specifically `dist.test.ts` › "ships no JavaScript". If this fails, the dynamic import was not eliminated; that is a real regression against a Global Constraint, not a test to relax.

- [ ] **Step 6: Deploy both, then drive the real thing**

```bash
pnpm --filter site build:preview
pnpm --filter site exec wrangler deploy --config wrangler.preview.jsonc
pnpm build:studio
pnpm --filter studio exec wrangler deploy
```

- [ ] **Step 7: Verify live preview end to end, by hand**

Open `https://studio.softmess.de/presentation`. Confirm, in order:

1. The site renders in the iframe (the handshake redirected and set the cookie).
2. Editing `homePage.heading` in the form updates the iframe after its reload.
3. Clicking the heading **in the iframe** focuses that field in the form (overlays + stega).
4. Clicking the footer's imprint link in the iframe moves the form to that document (document location resolution).
5. Opening `https://preview.softmess.de/` in a private window shows **published** content — no draft text, no overlay.

Item 5 is the one that leaks rather than breaks. If it fails, stop and fix before continuing.

- [ ] **Step 8: Commit**

```bash
git add studio/presentation studio/sanity.config.ts site/src/layouts/Base.astro
git commit -m "feat(studio): adopt Presentation mode against the preview Worker"
```

---

## Task 4: German Studio, umlaut slugs, and real singleton protection

Three schema-level foundations the page builder needs. Each has a failure mode that is invisible until the owner hits it.

**Files:**
- Create: `studio/lib/slugify.ts`
- Create: `studio/lib/singletons.ts`
- Modify: `studio/sanity.config.ts`
- Modify: `studio/package.json` (add `vitest` and a `test` script)
- Modify: `package.json` (root — add the studio tests to `pnpm verify`)
- Test: `studio/lib/slugify.test.ts`

**Interfaces:**
- Produces: `slugifyGerman(input: string): string` from `studio/lib/slugify.ts`; `SINGLETON_TYPES: readonly string[]` from `studio/lib/singletons.ts`.

- [ ] **Step 1: Write the failing test**

Create `studio/lib/slugify.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {slugifyGerman} from './slugify'

describe('slugifyGerman', () => {
  it('transliterates umlauts rather than lowercasing them', () => {
    // Sanity's default slugify produces "über-uns", which then fails the
    // ^[a-z0-9-]+$ rule on a string that looks lowercase to a German speaker.
    expect(slugifyGerman('Über uns')).toBe('ueber-uns')
    expect(slugifyGerman('Größe & Qualität')).toBe('groesse-qualitaet')
    expect(slugifyGerman('Straße')).toBe('strasse')
  })

  it('collapses separators and trims them from the ends', () => {
    expect(slugifyGerman('  Hallo   Welt!  ')).toBe('hallo-welt')
    expect(slugifyGerman('a---b')).toBe('a-b')
  })

  it('produces only characters the slug validation accepts', () => {
    expect(slugifyGerman('Ärzte & Ärztinnen, 2026')).toMatch(/^[a-z0-9-]+$/)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter studio exec vitest run lib/slugify.test.ts`
Expected: FAIL — `vitest` is not yet a studio dependency, then "Cannot find module './slugify'".

Add vitest first: `pnpm --filter studio add -D vitest@^4.1.10`, then re-run and expect the module-not-found failure.

- [ ] **Step 3: Write `studio/lib/slugify.ts`**

```ts
// German transliteration must happen *before* lowercasing, so that Ä maps to
// "ae" rather than to "ä" and then to a character the slug rule rejects.
const TRANSLITERATIONS: Array<[RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/Ä/g, 'Ae'],
  [/Ö/g, 'Oe'],
  [/Ü/g, 'Ue'],
  [/ß/g, 'ss'],
]

export function slugifyGerman(input: string): string {
  let value = input
  for (const [pattern, replacement] of TRANSLITERATIONS) {
    value = value.replace(pattern, replacement)
  }
  return value
    .toLowerCase()
    .normalize('NFD')
    // Combining diacritical marks, written as escapes rather than as literal
    // characters — they are invisible in an editor and trivially mangled.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter studio exec vitest run lib/slugify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the studio test run to `pnpm verify`**

In `studio/package.json` scripts add `"test": "vitest run"`. In the root `package.json`, change the `verify` script's tail to include it:

```json
"verify": "pnpm typegen && git diff --exit-code site/src/sanity.types.ts && pnpm --filter studio lint && pnpm --filter studio test && pnpm --filter site check && pnpm --filter site test"
```

- [ ] **Step 6: Create `studio/lib/singletons.ts`**

```ts
/** Types that must exist exactly once and must never be deleted. Deleting one
 *  makes every subsequent build fail on a null dereference while the live site
 *  keeps serving stale HTML — a failure that is invisible until publish. */
export const SINGLETON_TYPES = ['siteSettings', 'homePage'] as const
```

- [ ] **Step 7: Add the `document.actions` filter to `studio/sanity.config.ts`**

Filtering `templates` removes *creation* templates only; it does nothing about the ⋮ → Delete action. Add the import and the `document` block:

```ts
import {SINGLETON_TYPES} from './lib/singletons'

// ... inside defineConfig, as a sibling of `schema`:
  document: {
    actions: (previous, {schemaType}) =>
      SINGLETON_TYPES.includes(schemaType as (typeof SINGLETON_TYPES)[number])
        ? previous.filter(({action}) => action !== 'delete' && action !== 'duplicate')
        : previous,
  },
```

Also replace the inline array in the `templates` filter with `SINGLETON_TYPES.includes(schemaType as never)` so the list has one home.

- [ ] **Step 8: Add the German Studio locale**

```bash
pnpm --filter studio add @sanity/locale-de-de@^1.1.36
```

In `studio/sanity.config.ts`, import `{deDELocale} from '@sanity/locale-de-de'` and add `deDELocale()` to the `plugins` array, then add `i18n: {bundles: []}` only if the build complains — the plugin registers its own bundle.

- [ ] **Step 9: Verify the delete action is gone**

Run: `pnpm --filter studio dev`, open `http://localhost:3333`, navigate to Startseite, open the ⋮ menu.
Expected: no "Delete" and no "Duplicate" entries; Studio chrome is German.

- [ ] **Step 10: Commit**

```bash
git add studio package.json pnpm-lock.yaml
git commit -m "feat(studio): German locale, umlaut slugify, real singleton protection"
```

---

## Task 5: The `page` document type

**Files:**
- Create: `studio/schemaTypes/page.ts`
- Modify: `studio/schemaTypes/index.ts`
- Test: `studio/lib/slugify.test.ts` (extend with the reserved-slug rule) — or a new `studio/schemaTypes/page.test.ts`

**Interfaces:**
- Consumes: `slugifyGerman` from Task 4.
- Produces: the `page` document type, with fields `title`, `slug`, `pageBuilder`, `seo`. Task 6 defines `pageBuilder`; Task 9 queries this type.
- Produces: `RESERVED_SLUGS: readonly string[]` from `studio/lib/singletons.ts`.

- [ ] **Step 1: Write the failing test**

Create `studio/schemaTypes/page.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {isReservedSlug} from '../lib/singletons'

describe('reserved slugs', () => {
  it('reserves the product namespace before any product exists', () => {
    // Retrofitting /produkte/<slug> after a page has claimed /produkte is a
    // breaking URL change, so the namespace is defended from day one.
    expect(isReservedSlug('produkte')).toBe(true)
  })

  it('reserves the api namespace the preview handshake lives under', () => {
    expect(isReservedSlug('api')).toBe(true)
  })

  it('allows an ordinary page slug', () => {
    expect(isReservedSlug('ueber-uns')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter studio exec vitest run schemaTypes/page.test.ts`
Expected: FAIL — `isReservedSlug` is not exported.

- [ ] **Step 3: Add `isReservedSlug` to `studio/lib/singletons.ts`**

```ts
/** URL namespaces a page must never claim. `produkte` is reserved for the
 *  future catalogue; `api` is where the preview handshake lives. */
export const RESERVED_SLUGS = ['produkte', 'api'] as const

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug as (typeof RESERVED_SLUGS)[number])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter studio exec vitest run schemaTypes/page.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `studio/schemaTypes/page.ts`**

The uniqueness rule is written against `_type == "page"` but shaped so a future `product` type extends it by widening the filter, not by rewriting it.

```ts
import {defineField, defineType} from 'sanity'
import {DocumentIcon} from '@sanity/icons/Document'
import {slugifyGerman} from '../lib/slugify'
import {isReservedSlug} from '../lib/singletons'

export const page = defineType({
  name: 'page',
  title: 'Seite',
  type: 'document',
  icon: DocumentIcon,
  fields: [
    defineField({
      name: 'title',
      title: 'Titel',
      type: 'string',
      validation: (rule) => rule.required().error('Bitte einen Titel eingeben'),
    }),
    defineField({
      name: 'slug',
      title: 'Adresse',
      type: 'slug',
      description: 'Der Teil der Web-Adresse nach dem Schrägstrich, z. B. "ueber-uns"',
      options: {source: 'title', maxLength: 96, slugify: slugifyGerman},
      validation: (rule) =>
        rule.required().custom(async (slug, context) => {
          const current = slug?.current
          if (!current) return 'Bitte eine Adresse angeben'
          if (!/^[a-z0-9-]+$/.test(current)) {
            return 'Nur Kleinbuchstaben, Zahlen und Bindestriche'
          }
          if (isReservedSlug(current)) {
            return `"${current}" ist reserviert. Bitte eine andere Adresse wählen.`
          }
          const id = context.document?._id.replace(/^drafts\./, '')
          const taken = await context.getClient({apiVersion: '2026-08-15'}).fetch<boolean>(
            `defined(*[_type == "page" && slug.current == $slug && !(_id in [$id, "drafts." + $id])][0]._id)`,
            {slug: current, id},
          )
          return taken ? 'Diese Adresse wird bereits von einer anderen Seite benutzt' : true
        }),
    }),
    defineField({
      name: 'pageBuilder',
      title: 'Inhalt',
      type: 'pageBuilder',
    }),
    defineField({
      name: 'seo',
      title: 'Suchmaschinen',
      type: 'object',
      options: {collapsible: true, collapsed: true},
      fields: [
        defineField({name: 'title', title: 'Titel', type: 'string'}),
        defineField({
          name: 'description',
          title: 'Beschreibung',
          type: 'text',
          rows: 3,
          validation: (rule) => rule.max(160).warning('Möglichst unter 160 Zeichen halten'),
        }),
      ],
    }),
  ],
  preview: {
    select: {title: 'title', subtitle: 'slug.current'},
    prepare: ({title, subtitle}) => ({
      title: title || 'Ohne Titel',
      subtitle: subtitle ? `/${subtitle}` : 'Keine Adresse',
    }),
  },
})
```

- [ ] **Step 6: Do not register `page` yet**

`page` declares a `pageBuilder` field, which Task 6 creates. Registering it now makes `sanity schemas extract` fail on an unknown type. Task 6 Step 8 registers both together, which keeps the tree green at every commit.

- [ ] **Step 7: Verify the unit test and lint pass**

Run: `pnpm --filter studio test && pnpm --filter studio lint`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add studio/schemaTypes/page.ts studio/schemaTypes/page.test.ts studio/lib/singletons.ts
git commit -m "feat(studio): add the page document type with German slugs"
```

---

## Task 6: The five blocks and the page builder array

Sanity's documented failure mode for page builders is too many block types. Five, and they grow on demand.

**Files:**
- Create: `studio/schemaTypes/blocks/hero.ts`, `richText.ts`, `imageText.ts`, `gallery.ts`, `cta.ts`
- Create: `studio/schemaTypes/pageBuilder.ts`
- Modify: `studio/schemaTypes/index.ts`
- Modify: `studio/schemaTypes/homePage.ts`

**Interfaces:**
- Produces: object types `hero`, `richText`, `imageText`, `gallery`, `cta`; array type `pageBuilder`. Task 8 renders each one; the variant field names below are the exact strings its components compare after `stegaClean`.
- Variant field names, fixed here and depended on by Task 8: `hero.imagePosition` (`'links' | 'rechts'`), `richText.width` (`'schmal' | 'breit'`), `imageText.imagePosition` (`'links' | 'rechts'`), `imageText.background` (`'normal' | 'sand' | 'akzent'`), `gallery.columns` (`'2' | '3'`), `cta.background` (`'normal' | 'akzent'`).

- [ ] **Step 1: Extract the shared rich-text block into its own type**

Create `studio/schemaTypes/blocks/richText.ts`. This lifts the Portable Text configuration currently inline in `legalPage.ts` so both the legal pages and the page builder share one definition.

```ts
import {defineArrayMember, defineField, defineType} from 'sanity'
import {TextIcon} from '@sanity/icons/Text'

export const richText = defineType({
  name: 'richText',
  title: 'Text',
  type: 'object',
  icon: TextIcon,
  fields: [
    defineField({
      name: 'content',
      title: 'Inhalt',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'block',
          styles: [
            {title: 'Absatz', value: 'normal'},
            {title: 'Überschrift', value: 'h2'},
          ],
          lists: [{title: 'Liste', value: 'bullet'}],
          marks: {
            decorators: [
              {title: 'Fett', value: 'strong'},
              {title: 'Kursiv', value: 'em'},
            ],
            annotations: [
              defineArrayMember({
                name: 'link',
                type: 'object',
                title: 'Link',
                fields: [
                  defineField({
                    name: 'href',
                    title: 'Adresse',
                    type: 'url',
                    validation: (rule) =>
                      rule.required().uri({scheme: ['http', 'https', 'mailto']}),
                  }),
                ],
              }),
            ],
          },
        }),
      ],
      validation: (rule) => rule.required().error('Bitte Text eingeben'),
    }),
    defineField({
      name: 'width',
      title: 'Breite',
      type: 'string',
      initialValue: 'schmal',
      options: {list: [{title: 'Schmal', value: 'schmal'}, {title: 'Breit', value: 'breit'}], layout: 'radio'},
    }),
  ],
  preview: {
    select: {content: 'content'},
    prepare: ({content}) => ({
      title: content?.[0]?.children?.[0]?.text || 'Text',
      subtitle: 'Text',
      media: TextIcon,
    }),
  },
})
```

- [ ] **Step 2: Create `studio/schemaTypes/blocks/hero.ts`**

```ts
import {defineArrayMember, defineField, defineType} from 'sanity'
import {StarIcon} from '@sanity/icons/Star'

export const hero = defineType({
  name: 'hero',
  title: 'Aufmacher',
  type: 'object',
  icon: StarIcon,
  fields: [
    defineField({
      name: 'heading',
      title: 'Überschrift',
      type: 'string',
      validation: (rule) => rule.required().error('Bitte eine Überschrift eingeben'),
    }),
    defineField({
      name: 'statement',
      title: 'Statement',
      type: 'string',
      description: 'Die Zeile unter der Überschrift',
    }),
    defineField({
      name: 'body',
      title: 'Text',
      type: 'array',
      description: 'Bis zu zwei Absätze. Der erste wird hervorgehoben.',
      of: [defineArrayMember({type: 'text', rows: 3})],
      validation: (rule) => rule.max(2).warning('Höchstens zwei Absätze'),
    }),
    defineField({
      name: 'image',
      title: 'Bild',
      type: 'image',
      options: {hotspot: true},
      fields: [
        defineField({
          name: 'alt',
          title: 'Alternativtext',
          description: 'Beschreibt das Bild für Menschen, die es nicht sehen können',
          type: 'string',
          validation: (rule) => rule.required().error('Bitte einen Alternativtext eingeben'),
        }),
      ],
    }),
    defineField({
      name: 'imagePosition',
      title: 'Bildposition',
      type: 'string',
      initialValue: 'rechts',
      options: {list: [{title: 'Links', value: 'links'}, {title: 'Rechts', value: 'rechts'}], layout: 'radio'},
    }),
    defineField({
      name: 'actions',
      title: 'Aktionen',
      type: 'array',
      description: 'Knöpfe unter dem Text. Der erste wird gefüllt dargestellt.',
      of: [defineArrayMember({type: 'action'})],
    }),
  ],
  preview: {
    select: {title: 'heading', media: 'image'},
    prepare: ({title, media}) => ({title: title || 'Aufmacher', subtitle: 'Aufmacher', media: media ?? StarIcon}),
  },
})
```

- [ ] **Step 3: Create `studio/schemaTypes/blocks/imageText.ts`**

```ts
import {defineArrayMember, defineField, defineType} from 'sanity'
import {SplitHorizontalIcon} from '@sanity/icons/SplitHorizontal'

export const imageText = defineType({
  name: 'imageText',
  title: 'Bild mit Text',
  type: 'object',
  icon: SplitHorizontalIcon,
  fields: [
    defineField({
      name: 'image',
      title: 'Bild',
      type: 'image',
      options: {hotspot: true},
      validation: (rule) => rule.required().error('Bitte ein Bild auswählen'),
      fields: [
        defineField({
          name: 'alt',
          title: 'Alternativtext',
          type: 'string',
          validation: (rule) => rule.required().error('Bitte einen Alternativtext eingeben'),
        }),
      ],
    }),
    defineField({
      name: 'heading',
      title: 'Überschrift',
      type: 'string',
      validation: (rule) => rule.required().error('Bitte eine Überschrift eingeben'),
    }),
    defineField({name: 'body', title: 'Text', type: 'text', rows: 5}),
    defineField({
      name: 'actions',
      title: 'Aktionen',
      type: 'array',
      of: [defineArrayMember({type: 'action'})],
    }),
    defineField({
      name: 'imagePosition',
      title: 'Bildposition',
      type: 'string',
      initialValue: 'links',
      options: {list: [{title: 'Links', value: 'links'}, {title: 'Rechts', value: 'rechts'}], layout: 'radio'},
    }),
    defineField({
      name: 'background',
      title: 'Hintergrund',
      type: 'string',
      initialValue: 'normal',
      options: {
        list: [
          {title: 'Normal', value: 'normal'},
          {title: 'Sand', value: 'sand'},
          {title: 'Akzent', value: 'akzent'},
        ],
        layout: 'radio',
      },
    }),
  ],
  preview: {
    select: {title: 'heading', media: 'image'},
    prepare: ({title, media}) => ({title: title || 'Bild mit Text', subtitle: 'Bild mit Text', media: media ?? SplitHorizontalIcon}),
  },
})
```

- [ ] **Step 4: Create `studio/schemaTypes/blocks/gallery.ts`**

```ts
import {defineArrayMember, defineField, defineType} from 'sanity'
import {ImagesIcon} from '@sanity/icons/Images'

export const gallery = defineType({
  name: 'gallery',
  title: 'Galerie',
  type: 'object',
  icon: ImagesIcon,
  fields: [
    defineField({
      name: 'images',
      title: 'Bilder',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'image',
          options: {hotspot: true},
          fields: [
            defineField({
              name: 'alt',
              title: 'Alternativtext',
              type: 'string',
              validation: (rule) => rule.required().error('Bitte einen Alternativtext eingeben'),
            }),
          ],
        }),
      ],
      validation: (rule) => rule.min(1).error('Bitte mindestens ein Bild auswählen'),
    }),
    defineField({
      name: 'columns',
      title: 'Spalten',
      type: 'string',
      initialValue: '3',
      options: {list: [{title: '2 Spalten', value: '2'}, {title: '3 Spalten', value: '3'}], layout: 'radio'},
    }),
  ],
  preview: {
    select: {images: 'images', media: 'images.0'},
    prepare: ({images, media}) => ({
      title: `${images?.length ?? 0} Bilder`,
      subtitle: 'Galerie',
      media: media ?? ImagesIcon,
    }),
  },
})
```

- [ ] **Step 5: Create `studio/schemaTypes/blocks/cta.ts`**

```ts
import {defineArrayMember, defineField, defineType} from 'sanity'
import {RocketIcon} from '@sanity/icons/Rocket'

export const cta = defineType({
  name: 'cta',
  title: 'Aufruf',
  type: 'object',
  icon: RocketIcon,
  fields: [
    defineField({
      name: 'heading',
      title: 'Überschrift',
      type: 'string',
      validation: (rule) => rule.required().error('Bitte eine Überschrift eingeben'),
    }),
    defineField({name: 'body', title: 'Text', type: 'text', rows: 3}),
    defineField({
      name: 'actions',
      title: 'Aktionen',
      type: 'array',
      of: [defineArrayMember({type: 'action'})],
      validation: (rule) => rule.min(1).error('Bitte mindestens eine Aktion angeben'),
    }),
    defineField({
      name: 'background',
      title: 'Hintergrund',
      type: 'string',
      initialValue: 'akzent',
      options: {list: [{title: 'Normal', value: 'normal'}, {title: 'Akzent', value: 'akzent'}], layout: 'radio'},
    }),
  ],
  preview: {
    select: {title: 'heading'},
    prepare: ({title}) => ({title: title || 'Aufruf', subtitle: 'Aufruf', media: RocketIcon}),
  },
})
```

- [ ] **Step 6: Create `studio/schemaTypes/pageBuilder.ts`**

The grid insert menu means adding a block is picking a thumbnail, not choosing from a dropdown of type names. The preview images are static assets served by the Studio Worker from `studio/static/`.

```ts
import {defineArrayMember, defineType} from 'sanity'

export const pageBuilder = defineType({
  name: 'pageBuilder',
  title: 'Inhalt',
  type: 'array',
  of: [
    defineArrayMember({type: 'hero'}),
    defineArrayMember({type: 'richText'}),
    defineArrayMember({type: 'imageText'}),
    defineArrayMember({type: 'gallery'}),
    defineArrayMember({type: 'cta'}),
  ],
  options: {
    insertMenu: {
      views: [
        {name: 'grid', previewImageUrl: (schemaTypeName) => `/static/blocks/${schemaTypeName}.png`},
        {name: 'list'},
      ],
    },
  },
})
```

- [ ] **Step 7: Add placeholder block thumbnails**

Create `studio/static/blocks/` and add a PNG per block name (`hero.png`, `richText.png`, `imageText.png`, `gallery.png`, `cta.png`). A plain 320×180 wireframe sketch of each layout is enough — these are recognition aids, not artwork. The `list` view is registered as a fallback so a missing image degrades to type names rather than to blank tiles.

- [ ] **Step 8: Register everything**

`studio/schemaTypes/index.ts`:

```ts
import {action} from './action'
import {cta} from './blocks/cta'
import {gallery} from './blocks/gallery'
import {hero} from './blocks/hero'
import {imageText} from './blocks/imageText'
import {richText} from './blocks/richText'
import {homePage} from './homePage'
import {legalPage} from './legalPage'
import {page} from './page'
import {pageBuilder} from './pageBuilder'
import {siteSettings} from './siteSettings'

export const schemaTypes = [
  siteSettings,
  homePage,
  page,
  legalPage,
  pageBuilder,
  hero,
  richText,
  imageText,
  gallery,
  cta,
  action,
]
```

- [ ] **Step 9: Replace `homePage`'s fields with the page builder**

In `studio/schemaTypes/homePage.ts`, keep `name`, `type`, `icon` and the singleton id, replace the whole `fields` array with a single `pageBuilder` field, and translate the preview:

```ts
  title: 'Startseite',
  fields: [defineField({name: 'pageBuilder', title: 'Inhalt', type: 'pageBuilder'})],
  preview: {prepare: () => ({title: 'Startseite'})},
```

Remove the now-unused `defineArrayMember` import.

**Do not deploy this schema change until Task 10's migration has run** — the existing `homePage` document still holds `heading`/`statement`/`body`/`charm`/`actions`, which this schema no longer describes. The data is not deleted, just unmapped, and the migration converts it.

- [ ] **Step 10: Verify the schema extracts and types regenerate**

Run: `pnpm typegen`
Expected: exits 0, `site/src/sanity.types.ts` updates with `Hero`, `RichText`, `ImageText`, `Gallery`, `Cta`, `Page` types. This diff is expected and gets committed; `pnpm verify`'s `git diff --exit-code` only fails when types are *stale*.

- [ ] **Step 11: Commit**

```bash
git add studio/schemaTypes studio/static site/src/sanity.types.ts
git commit -m "feat(studio): add five page-builder blocks and the pageBuilder array"
```

---

## Task 7: Explicit navigation and grouped site settings

`LEGAL_PAGE_NAV_QUERY` auto-lists legal pages sorted by title. Replacing it with explicit link arrays is control the owner gains — and a way to publish a page linked from nowhere, which the orphan warning covers.

**Files:**
- Modify: `studio/schemaTypes/siteSettings.ts`
- Create: `studio/schemaTypes/navLink.ts`
- Modify: `studio/schemaTypes/index.ts`, `studio/schemaTypes/page.ts`

**Interfaces:**
- Produces: `navLink` object type with fields `label` (string) and `page` (reference to `page`). Task 9's `Footer.astro` and `Header.astro` consume `{label, "slug": page->slug.current}`.

- [ ] **Step 1: Create `studio/schemaTypes/navLink.ts`**

Referencing a document rather than a type-specific field is what makes adding `product` later a one-line change.

```ts
import {defineField, defineType} from 'sanity'
import {LinkIcon} from '@sanity/icons/Link'

export const navLink = defineType({
  name: 'navLink',
  title: 'Navigationslink',
  type: 'object',
  icon: LinkIcon,
  fields: [
    defineField({
      name: 'label',
      title: 'Beschriftung',
      type: 'string',
      description: 'Wie der Link heißt. Leer lassen, um den Seitentitel zu benutzen.',
    }),
    defineField({
      name: 'page',
      title: 'Seite',
      type: 'reference',
      to: [{type: 'page'}],
      validation: (rule) => rule.required().error('Bitte eine Seite auswählen'),
    }),
  ],
  preview: {
    select: {label: 'label', title: 'page.title', subtitle: 'page.slug.current'},
    prepare: ({label, title, subtitle}) => ({
      title: label || title || 'Ohne Titel',
      subtitle: subtitle ? `/${subtitle}` : undefined,
    }),
  },
})
```

- [ ] **Step 2: Add link arrays and field groups to `siteSettings`**

`siteSettings` grows past a dozen fields; groups keep it navigable. Add to `defineType`, before `fields`:

```ts
  groups: [
    {name: 'brand', title: 'Marke', default: true},
    {name: 'navigation', title: 'Navigation'},
    {name: 'notFound', title: '404'},
    {name: 'seo', title: 'Suchmaschinen'},
  ],
```

Assign each existing field to a group via `group: 'brand' | 'navigation' | 'notFound' | 'seo'`: `brand`, `tagline`, `email`, `instagram`, `instagramHandle`, `copyright` → `brand`; `backLabel`, `instagramLabel` → `navigation`; `notFound` → `notFound`; `seo` → `seo`. Translate every `title` and `description` to German while you are in the file.

Then add the two link arrays, in the `navigation` group:

```ts
    defineField({
      name: 'headerLinks',
      title: 'Links in der Kopfzeile',
      type: 'array',
      group: 'navigation',
      of: [defineArrayMember({type: 'navLink'})],
    }),
    defineField({
      name: 'footerLinks',
      title: 'Links in der Fußzeile',
      type: 'array',
      group: 'navigation',
      of: [defineArrayMember({type: 'navLink'})],
    }),
```

Add `defineArrayMember` to the `sanity` import.

- [ ] **Step 3: Add the orphan-page warning to `page.ts`**

A published page reachable by URL but linked from nowhere is the predictable cost of explicit navigation. This warns rather than errors, because a deliberately unlinked page is legitimate.

Add to the `page` type's `defineType`, as a sibling of `fields`:

```ts
  validation: (rule) =>
    rule.custom(async (doc, context) => {
      if (!doc?._id) return true
      const id = doc._id.replace(/^drafts\./, '')
      const linked = await context.getClient({apiVersion: '2026-08-15'}).fetch<boolean>(
        // navLink stores its reference under `page`, so the refs live at
        // headerLinks[].page._ref — not at headerLinks[]._ref.
        `count(*[_id == "siteSettings"][0].headerLinks[page._ref == $id]) +
         count(*[_id == "siteSettings"][0].footerLinks[page._ref == $id]) > 0`,
        {id},
      )
      return linked
        ? true
        : 'Diese Seite ist über die Adresse erreichbar, aber von nirgendwo verlinkt. Unter Website-Einstellungen → Navigation kann sie verlinkt werden.'
    }).warning(),
```

- [ ] **Step 4: Register `navLink`**

Add it to the imports and the `schemaTypes` array in `studio/schemaTypes/index.ts`.

- [ ] **Step 5: Verify**

Run: `pnpm typegen && pnpm --filter studio lint`
Expected: exits 0. Open `pnpm --filter studio dev` and confirm Website-Einstellungen shows four tabs and two link arrays.

- [ ] **Step 6: Commit**

```bash
git add studio/schemaTypes site/src/sanity.types.ts
git commit -m "feat(studio): explicit navigation links and grouped site settings"
```

---

## Task 8: Render the blocks

Blocks become `.astro` components. No new framework, no client JavaScript on the public build.

**Files:**
- Create: `site/src/components/PageBuilder.astro`
- Create: `site/src/components/blocks/Hero.astro`, `RichText.astro`, `ImageText.astro`, `Gallery.astro`, `Cta.astro`
- Create: `site/src/components/Actions.astro`
- Create: `site/src/lib/variants.ts`
- Create: `site/src/lib/blocks.ts`
- Test: `site/test/variants.test.ts`

**Interfaces:**
- Consumes: the block types from Task 6, via the generated `site/src/sanity.types.ts`.
- Produces from `src/lib/blocks.ts`: `PageBuilderBlock` (the union of all block shapes as the query returns them) and `BlockOfType<T>` (one member of that union). Every block component's props derive from `BlockOfType<'…'>`, so a schema change that drops a field is a type error at the component rather than a blank section on the page.
- Produces: `PageBuilder.astro` with props `{blocks?: PageBuilderBlock[] | null}`; each block component takes its own block type spread as props, plus `semanticLevel: 'h1' | 'h2'` where it renders a heading.
- Produces from `src/lib/variants.ts`: `clean(value: string | undefined): string | undefined`, `pick<T extends string>(value: string | undefined, map: Record<T, string>, fallback: T): string`.

**Ordering note — do this first.** TypeGen describes *query results*, not schema types, so `PageBuilderBlock` cannot exist until the page-builder projection does. Before Step 5 below: open `site/src/lib/content.ts`, add the `PAGE_BUILDER_PROJECTION` constant and the four new query constants exactly as written in **Task 9 Step 1** (the queries only — leave the getters alone for now), then run `pnpm typegen`. Commit that with this task. Task 9 Step 1 then only has the getters left to do.

- [ ] **Step 1: Write the failing test**

Create `site/test/variants.test.ts`:

First add the encoder as a dev dependency — it is a transitive dependency of
`@sanity/client`, and the test needs a *real* payload. Hand-typed zero-width
characters do not work: `stegaClean` only strips runs it can decode, so a made-up
string would pass the test while proving nothing.

```bash
pnpm --filter site add -D @vercel/stega@^1.1.0
```

```ts
import {describe, expect, it} from 'vitest'
import {vercelStegaCombine} from '@vercel/stega'
import {clean, pick} from '../src/lib/variants'

const BACKGROUNDS = {normal: 'bg-bg', sand: 'bg-sand-200', akzent: 'bg-accent-200'}

describe('variant mapping', () => {
  it('maps a plain value', () => {
    expect(pick('sand', BACKGROUNDS, 'normal')).toBe('bg-sand-200')
  })

  it('falls back when the value is missing', () => {
    expect(pick(undefined, BACKGROUNDS, 'normal')).toBe('bg-bg')
  })

  it('maps a stega-encoded value instead of silently falling through', () => {
    // Stega encodes an invisible payload into every string when preview is on —
    // roughly 240 characters for a value of this size. Without cleaning,
    // `encoded === 'sand'` is false and every block in the preview renders with
    // its default styling: a bug that appears only in preview, which is exactly
    // where the owner is judging the design.
    const encoded = vercelStegaCombine('sand', {
      origin: 'sanity.io',
      href: 'https://studio.softmess.de',
    })
    expect(encoded).not.toBe('sand')
    expect(clean(encoded)).toBe('sand')
    expect(pick(encoded, BACKGROUNDS, 'normal')).toBe('bg-sand-200')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter site exec vitest run test/variants.test.ts`
Expected: FAIL — "Cannot find module '../src/lib/variants'".

- [ ] **Step 3: Write `site/src/lib/variants.ts`**

```ts
import {stegaClean} from '@sanity/client/stega'

/** Strip stega markers from a value that is about to be compared. Never call
 *  this on Portable Text — it removes the markers that make overlays work. */
export function clean(value: string | undefined): string | undefined {
  return value === undefined ? undefined : (stegaClean(value) as string)
}

/** Map a variant string to a class, falling back when it is missing or unknown. */
export function pick<T extends string>(
  value: string | undefined,
  map: Record<T, string>,
  fallback: T,
): string {
  const key = clean(value) as T | undefined
  return (key && map[key]) || map[fallback]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter site exec vitest run test/variants.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `site/src/lib/blocks.ts`**

```ts
import type {HOME_PAGE_QUERY_RESULT} from '../sanity.types'

/** Every block shape the page-builder projection can return. Derived from the
 *  generated query result rather than hand-written, so schema drift surfaces
 *  as a type error in the component instead of as a blank section. */
export type PageBuilderBlock = NonNullable<
  NonNullable<HOME_PAGE_QUERY_RESULT>['pageBuilder']
>[number]

/** One member of that union, picked by `_type`. */
export type BlockOfType<T extends PageBuilderBlock['_type']> = Extract<
  PageBuilderBlock,
  {_type: T}
>
```

- [ ] **Step 6: Create `site/src/components/Actions.astro`**

Lifts the button markup currently inline in `index.astro` so `hero`, `imageText` and `cta` share it.

```astro
---
interface Props {
  actions?: Array<{_key: string; label?: string | null; href?: string | null}> | null
}
const {actions} = Astro.props
const primary =
  'flex-[1_1_260px] bg-accent text-bg shadow-sm hover:bg-accent-600 active:bg-accent-700'
const secondary = 'flex-[1_1_200px] border border-ink/18 text-ink hover:bg-ink/7'
---

{
  actions && actions.length > 0 && (
    <div class="flex flex-wrap items-center gap-3">
      {actions.map((action, index) => (
        <a
          href={action.href}
          {...action.href?.startsWith('http')
            ? {target: '_blank', rel: 'noopener noreferrer'}
            : {}}
          class:list={[
            'inline-flex min-h-[54px] items-center justify-center gap-[10px] rounded-full px-[26px] font-sans text-[17px] no-underline',
            index === 0 ? primary : secondary,
          ]}
        >
          {action.label}
        </a>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Create `site/src/components/blocks/Hero.astro`**

Ports the existing home-page markup verbatim, with the heading tag and image side now driven by props. `semanticLevel` is a prop, never a stored field.

```astro
---
import {srcSetFor, urlFor} from '../../lib/image'
import {pick} from '../../lib/variants'
import type {BlockOfType} from '../../lib/blocks'
import Actions from '../Actions.astro'

interface Props extends BlockOfType<'hero'> {
  semanticLevel: 'h1' | 'h2'
}

const {heading, statement, body, image, imagePosition, actions, semanticLevel} = Astro.props
const Heading = semanticLevel
const order = pick(imagePosition ?? undefined, {links: 'order-first', rechts: 'order-last'}, 'rechts')
---

<section
  class="relative grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-center gap-[clamp(28px,6vw,72px)] px-[clamp(22px,6vw,88px)] pt-[clamp(8px,3vw,48px)] pb-[clamp(32px,6vw,72px)]"
>
  <div class="max-w-[620px]">
    <Heading
      class="mb-4 font-display text-[length:var(--text-hero)] leading-none font-normal tracking-[0.01em] text-accent"
    >
      {heading}
    </Heading>
    {
      statement && (
        <p class="mb-6 text-[length:var(--text-statement)] leading-[1.2] font-bold tracking-[-0.01em] text-ink">
          {statement}
        </p>
      )
    }
    {
      body?.map((paragraph, index) => (
        <p
          class:list={[
            'max-w-[44ch] text-[18px] leading-[1.6] text-pretty',
            index === 0 ? 'mb-2 text-ink' : 'mb-8 text-muted',
          ]}
        >
          {paragraph}
        </p>
      ))
    }
    <Actions actions={actions} />
  </div>

  {
    image?.asset && (
      <img
        class:list={['w-full rounded-[28px] object-cover', order]}
        src={urlFor(image).width(560).height(700).format('webp').quality(80).url()}
        srcset={srcSetFor(image, 560, 700)}
        width="560"
        height="700"
        alt={image.alt ?? ''}
        loading="eager"
      />
    )
  }
</section>
```

- [ ] **Step 8: Create `site/src/components/blocks/RichText.astro`**

Portable Text goes to `<PortableText />` untouched — no `stegaClean`, which would strip the overlay markers.

```astro
---
import Prose from '../Prose.astro'
import {pick} from '../../lib/variants'
import type {BlockOfType} from '../../lib/blocks'

type Props = BlockOfType<'richText'>

const {content, width} = Astro.props
const maxWidth = pick(width ?? undefined, {schmal: 'max-w-[760px]', breit: 'max-w-[1100px]'}, 'schmal')
---

<section class:list={['relative px-[clamp(24px,6vw,88px)] py-[clamp(24px,4vw,48px)]', maxWidth]}>
  <Prose value={content} />
</section>
```

- [ ] **Step 9: Create `site/src/components/blocks/ImageText.astro`**

```astro
---
import {srcSetFor, urlFor} from '../../lib/image'
import {pick} from '../../lib/variants'
import type {BlockOfType} from '../../lib/blocks'
import Actions from '../Actions.astro'

interface Props extends BlockOfType<'imageText'> {
  semanticLevel: 'h1' | 'h2'
}

const {image, heading, body, actions, imagePosition, background, semanticLevel} = Astro.props
const Heading = semanticLevel
const order = pick(imagePosition ?? undefined, {links: 'order-first', rechts: 'order-last'}, 'links')
const bg = pick(background ?? undefined, {normal: 'bg-transparent', sand: 'bg-sand-200', akzent: 'bg-accent-200'}, 'normal')
---

<section
  class:list={[
    'relative grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-center gap-[clamp(28px,6vw,64px)] px-[clamp(22px,6vw,88px)] py-[clamp(32px,5vw,64px)]',
    bg,
  ]}
>
  {
    image?.asset && (
      <img
        class:list={['w-full rounded-[28px] object-cover', order]}
        src={urlFor(image).width(560).height(560).format('webp').quality(80).url()}
        srcset={srcSetFor(image, 560, 560)}
        width="560"
        height="560"
        alt={image.alt ?? ''}
        loading="lazy"
      />
    )
  }
  <div class="max-w-[560px]">
    <Heading class="mb-4 font-display text-[length:var(--text-page-title)] font-normal text-accent">
      {heading}
    </Heading>
    {body && <p class="mb-6 max-w-[44ch] text-[18px] leading-[1.6] text-pretty text-ink">{body}</p>}
    <Actions actions={actions} />
  </div>
</section>
```

- [ ] **Step 10: Create `site/src/components/blocks/Gallery.astro`**

```astro
---
import {srcSetFor, urlFor} from '../../lib/image'
import {pick} from '../../lib/variants'
import type {BlockOfType} from '../../lib/blocks'

type Props = BlockOfType<'gallery'>

const {images, columns} = Astro.props
const grid = pick(columns ?? undefined, {'2': 'sm:grid-cols-2', '3': 'sm:grid-cols-3'}, '3')
---

{
  images && images.length > 0 && (
    <section class="relative px-[clamp(22px,6vw,88px)] py-[clamp(24px,4vw,48px)]">
      <div class:list={['grid grid-cols-1 gap-4', grid]}>
        {images.map((image) => (
          <img
            class="w-full rounded-[20px] object-cover"
            src={urlFor(image).width(480).height(480).format('webp').quality(80).url()}
            srcset={srcSetFor(image, 480, 480)}
            width="480"
            height="480"
            alt={image.alt ?? ''}
            loading="lazy"
          />
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 11: Create `site/src/components/blocks/Cta.astro`**

```astro
---
import {pick} from '../../lib/variants'
import type {BlockOfType} from '../../lib/blocks'
import Actions from '../Actions.astro'

interface Props extends BlockOfType<'cta'> {
  semanticLevel: 'h1' | 'h2'
}

const {heading, body, actions, background, semanticLevel} = Astro.props
const Heading = semanticLevel
const bg = pick(background ?? undefined, {normal: 'bg-transparent', akzent: 'bg-accent-200'}, 'akzent')
---

<section
  class:list={[
    'relative flex flex-col items-start gap-4 px-[clamp(22px,6vw,88px)] py-[clamp(32px,5vw,64px)]',
    bg,
  ]}
>
  <Heading class="font-display text-[length:var(--text-page-title)] font-normal text-accent">
    {heading}
  </Heading>
  {body && <p class="max-w-[52ch] text-[18px] leading-[1.6] text-pretty text-ink">{body}</p>}
  <Actions actions={actions} />
</section>
```

- [ ] **Step 12: Create `site/src/components/PageBuilder.astro`**

The `semanticLevel` rule lives here and nowhere else: the first block gets the page's only `h1`.

```astro
---
import Cta from './blocks/Cta.astro'
import Gallery from './blocks/Gallery.astro'
import Hero from './blocks/Hero.astro'
import ImageText from './blocks/ImageText.astro'
import RichText from './blocks/RichText.astro'
import type {PageBuilderBlock} from '../lib/blocks'

interface Props {
  blocks?: PageBuilderBlock[] | null
}

const {blocks} = Astro.props
---

<main class="relative flex-1">
  {
    blocks?.map((block, index) => {
      // Never store heading levels in content: the first block owns the h1,
      // everything after it starts at h2.
      const semanticLevel = index === 0 ? 'h1' : 'h2'
      switch (block._type) {
        case 'hero':
          return <Hero key={block._key} {...block} semanticLevel={semanticLevel} />
        case 'richText':
          return <RichText key={block._key} {...block} />
        case 'imageText':
          return <ImageText key={block._key} {...block} semanticLevel={semanticLevel} />
        case 'gallery':
          return <Gallery key={block._key} {...block} />
        case 'cta':
          return <Cta key={block._key} {...block} semanticLevel={semanticLevel} />
        default:
          return null
      }
    })
  }
</main>
```

- [ ] **Step 13: Verify types and tests**

Run: `pnpm --filter site check && pnpm --filter site exec vitest run test/variants.test.ts`
Expected: exits 0, 3 tests pass. A `switch` case whose block component no longer accepts a field the query returns is a type error here — that is the drift protection working.

- [ ] **Step 14: Commit**

```bash
git add site/src/components site/src/lib/variants.ts site/src/lib/blocks.ts site/test/variants.test.ts
git commit -m "feat(site): render page-builder blocks as Astro components"
```

---

## Task 9: Rewire the routes, the navigation and the fixtures

**Files:**
- Modify: `site/src/lib/content.ts` (queries)
- Modify: `site/src/pages/index.astro`, `site/src/pages/[slug].astro`
- Modify: `site/src/layouts/Base.astro`, `site/src/components/Header.astro`, `site/src/components/Footer.astro`
- Modify: `studio/presentation/resolve.ts`
- Create: `site/test/fixtures/pages.json`; modify `site/test/fixtures/homePage.json`, `siteSettings.json`
- Modify: `site/test/dist.test.ts`, `site/test/content.test.ts`

**Interfaces:**
- Consumes: `PageBuilder.astro` from Task 8; the `page`/`navLink` types from Tasks 5 and 7.
- Produces: `getPage(client, slug)`, `getPageSlugs(client)`, `getNav(client)` in `content.ts`; `HOME_PAGE_QUERY` and `PAGE_QUERY` both projecting `pageBuilder[]{...}`.

- [ ] **Step 1: Replace the queries in `site/src/lib/content.ts`**

If you followed Task 8's ordering note, the four query constants below already exist and only the getters at the end of this step remain.

`_key` and `_type` must be projected on every array member — they are the render key and the switch discriminant, and stega source maps need `_key` to resolve an array path.

```ts
const PAGE_BUILDER_PROJECTION = `
  pageBuilder[]{
    _key, _type,
    _type == "hero" => {heading, statement, body, image{alt, asset}, imagePosition, actions[]{_key, label, href}},
    _type == "richText" => {content, width},
    _type == "imageText" => {image{alt, asset}, heading, body, imagePosition, background, actions[]{_key, label, href}},
    _type == "gallery" => {images[]{_key, alt, asset}, columns},
    _type == "cta" => {heading, body, background, actions[]{_key, label, href}}
  }
`

export const HOME_PAGE_QUERY = defineQuery(`
  *[_id == "homePage" && _type == "homePage"][0]{${PAGE_BUILDER_PROJECTION}}
`)

export const PAGE_SLUGS_QUERY = defineQuery(`
  *[_type == "page" && defined(slug.current)].slug.current
`)

export const PAGE_QUERY = defineQuery(`
  *[_type == "page" && slug.current == $slug][0]{
    title, "slug": slug.current, seo{title, description},
    ${PAGE_BUILDER_PROJECTION}
  }
`)

export const NAV_QUERY = defineQuery(`
  *[_id == "siteSettings"][0]{
    headerLinks[]{_key, label, "title": page->title, "slug": page->slug.current},
    footerLinks[]{_key, label, "title": page->title, "slug": page->slug.current}
  }
`)
```

Delete `LEGAL_PAGE_SLUGS_QUERY`, `LEGAL_PAGE_QUERY`, `LEGAL_PAGE_NAV_QUERY` and their three getters. Replace the `legalPagesFixture` import with `import pagesFixture from '../../test/fixtures/pages.json'`, replace the `LegalPage` type alias with `Page`, add a `Nav` alias, and add the three new getters:

```ts
export type Page = NonNullable<PAGE_QUERY_RESULT>
export type Nav = NonNullable<NAV_QUERY_RESULT>

export async function getPageSlugs(client: SanityClient): Promise<string[]> {
  if (USE_FIXTURES) {
    return (pagesFixture as Array<{slug: {current: string}}>).map((p) => p.slug.current)
  }
  return (await client.fetch(PAGE_SLUGS_QUERY)) as string[]
}

export async function getPage(client: SanityClient, slug: string): Promise<Page | null> {
  if (USE_FIXTURES) {
    const match = (pagesFixture as Array<{slug: {current: string}}>).find(
      (page) => page.slug.current === slug,
    )
    if (!match) return null
    // PAGE_QUERY projects `"slug": slug.current`, flattening the document's
    // `slug: {current}` object to a plain string — match that shape here too.
    return {...match, slug: match.slug.current} as unknown as Page
  }
  return ((await client.fetch(PAGE_QUERY, {slug})) as Page) ?? null
}

export async function getNav(client: SanityClient): Promise<Nav> {
  if (USE_FIXTURES) {
    const settings = siteSettingsFixture as unknown as Nav
    return {headerLinks: settings.headerLinks ?? [], footerLinks: settings.footerLinks ?? []}
  }
  return ((await client.fetch(NAV_QUERY)) as Nav) ?? {headerLinks: [], footerLinks: []}
}
```

Import `PAGE_QUERY_RESULT` and `NAV_QUERY_RESULT` from `../sanity.types` alongside the existing result types, and drop `LEGAL_PAGE_QUERY_RESULT`.

**Guard the singletons.** A deleted `homePage` or `siteSettings` currently crashes the build on a null dereference. Make each singleton getter fail with a sentence instead:

```ts
export async function getSiteSettings(client: SanityClient): Promise<SiteSettings> {
  if (USE_FIXTURES) return siteSettingsFixture as unknown as SiteSettings
  const settings = (await client.fetch(SITE_SETTINGS_QUERY)) as SiteSettings | null
  if (!settings) {
    throw new Error(
      'Das Dokument "Website-Einstellungen" fehlt in Sanity. Ohne es kann die Website nicht gebaut werden.',
    )
  }
  return settings
}
```

Apply the same guard to `getHomePage`.

- [ ] **Step 2: Rewrite `site/src/pages/index.astro`**

```astro
---
import Base from '../layouts/Base.astro'
import PageBuilder from '../components/PageBuilder.astro'
import {getHomePage, getSiteSettings} from '../lib/content'

const client = Astro.locals.sanity
const [settings, home] = await Promise.all([getSiteSettings(client), getHomePage(client)])
const title = settings.seo?.title ?? `${settings.brand} ${settings.tagline ?? ''}`.trim()
---

<Base title={title} settings={settings}>
  <PageBuilder blocks={home.pageBuilder} />
</Base>
```

- [ ] **Step 3: Rewrite `site/src/pages/[slug].astro`**

```astro
---
import Base from '../layouts/Base.astro'
import PageBuilder from '../components/PageBuilder.astro'
import {getPage, getSiteSettings} from '../lib/content'

// Astro hoists getStaticPaths into its own module context, so it imports what
// it needs itself rather than closing over module-scope bindings.
export async function getStaticPaths() {
  const {publishedClient} = await import('../lib/sanity')
  const {getPageSlugs} = await import('../lib/content')
  const slugs = await getPageSlugs(publishedClient)
  return slugs.map((slug) => ({params: {slug}}))
}

const client = Astro.locals.sanity
const {slug} = Astro.params
const [settings, page] = await Promise.all([getSiteSettings(client), getPage(client, slug!)])

if (!page) {
  return new Response(null, {status: 404})
}
---

<Base
  title={page.seo?.title ?? `${page.title} · ${settings.brand}`}
  description={page.seo?.description ?? undefined}
  settings={settings}
>
  <PageBuilder blocks={page.pageBuilder} />
</Base>
```

Note the top-level `getPageSlugs` import is unused once `getStaticPaths` imports its own copy — drop it from the import list. In static mode `getStaticPaths` enumerates the routes; in preview mode Astro skips it and `slug` comes from the request, so an unpublished page previews at its URL without a rebuild.

- [ ] **Step 4: Rewire the navigation components**

- `Base.astro`: replace `getLegalPageNav` with `getNav(Astro.locals.sanity)`, set `<html lang="de">`, and pass `nav.headerLinks` / `nav.footerLinks` to `Header` and `Footer`.
- `Header.astro`: add a `links` prop and render them beside the wordmark.
- `Footer.astro`: replace the `legalPages` prop with `links`, rendering `link.label ?? link.title` at `/${link.slug}`, keeping the Instagram link last.

- [ ] **Step 5: Extend the Presentation locations**

In `studio/presentation/resolve.ts`, replace the `legalPage` entry with:

```ts
    page: defineLocations({
      select: {title: 'title', slug: 'slug.current'},
      resolve: (doc) => ({
        locations: [{title: doc?.title || 'Ohne Titel', href: `/${doc?.slug}`}],
      }),
    }),
```

- [ ] **Step 6: Rebuild the fixtures**

`site/test/fixtures/homePage.json` becomes `{"pageBuilder": [...]}` with one block of **each** of the five types, so the fixture build exercises every renderer. Create `site/test/fixtures/pages.json` with two `page` documents (`impressum`, `datenschutz`), each holding one `richText` block, and delete `legalPages.json`. Add `headerLinks`/`footerLinks` to `siteSettings.json` with `title` and `slug` already flattened, matching `NAV_QUERY`'s projection.

- [ ] **Step 7: Update the dist tests**

In `site/test/dist.test.ts`: change `PAGES` to `['index.html', 'impressum/index.html', 'datenschutz/index.html', '404.html']`, update the footer-nav assertion to the new slugs, and add three assertions:

```ts
describe('page builder', () => {
  it('renders every block type', () => {
    const d = doc('index.html')
    expect(d.querySelectorAll('main > section')).toHaveLength(5)
  })

  it('renders blocks in array order', () => {
    // The fixture's block order is hero, richText, imageText, gallery, cta.
    // Rendering out of order would be invisible to every other assertion here.
    const sections = [...doc('index.html').querySelectorAll('main > section')]
    expect(sections[0].querySelector('h1')).not.toBeNull()
    expect(sections[3].querySelectorAll('img').length).toBeGreaterThan(1)
  })

  it('gives the page exactly one h1, on the first block', () => {
    const d = doc('index.html')
    expect(d.querySelectorAll('h1')).toHaveLength(1)
    expect(d.querySelector('main > section:first-child h1')).not.toBeNull()
  })

  it('maps variants to classes rather than falling through to defaults', () => {
    // The sand-background imageText block in the fixtures proves the variant
    // reached a class instead of silently defaulting.
    expect(doc('index.html').querySelector('.bg-sand-200')).not.toBeNull()
  })

  it('keeps the preview hostname out of the static build', () => {
    for (const page of PAGES) {
      expect(readFileSync(join(DIST, page), 'utf8')).not.toContain('preview.softmess.de')
    }
  })
})
```

- [ ] **Step 8: Update the content tests**

Rewrite `site/test/content.test.ts`'s legal-page cases as page cases: `getPageSlugs` returns `['impressum', 'datenschutz']`, `getPage(client, 'impressum')` resolves, `getPage(client, 'nope')` returns null.

- [ ] **Step 9: Run the full verification**

Run: `pnpm verify`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add site studio/presentation
git commit -m "feat(site): render pages from the page builder and explicit nav"
```

---

## Task 10: Migrate the content, in German, with the privacy fix

**Files:**
- Create: `seed/migrate.ts`
- Modify: `seed/package.json`
- Create: `site/public/_redirects`
- Modify: `studio/schemaTypes/index.ts`, delete `studio/schemaTypes/legalPage.ts`
- Modify: `studio/structure.ts`

**Interfaces:**
- Consumes: the `page`, `pageBuilder` and `navLink` types.
- Produces: `pnpm --filter seed migrate` (dry run) and `MIGRATE_APPLY=1 pnpm --filter seed migrate`.

- [ ] **Step 1: Export the dataset first**

This costs nothing, works on any plan, and is the only real undo.

```bash
pnpm --filter studio exec sanity dataset export production ./backup-$(date +%Y%m%d).tar.gz
```

- [ ] **Step 2: Write `seed/migrate.ts`**

Mirrors `seed/seed.ts`'s client construction and env loading. The transaction is built first and applied second, so the dry run prints exactly what the apply will do.

```ts
import {createClient} from '@sanity/client'

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET!,
  apiVersion: '2026-08-15',
  useCdn: false,
  token: process.env.SANITY_WRITE_TOKEN,
})

// Dry run by default. MIGRATE_APPLY=1 is the only thing that writes.
const APPLY = process.env.MIGRATE_APPLY === '1'

// Sanity requires a unique _key on every array member and does not add one for
// you on programmatic writes. A missing _key breaks drag-reorder and overlays.
const key = () => crypto.randomUUID().slice(0, 12)

const SLUGS: Record<string, string> = {imprint: 'impressum', privacy: 'datenschutz'}

const mutations: Array<Record<string, unknown>> = []

// 1. homePage's five fields collapse into one hero block.
const home = await client.getDocument('homePage')
if (!home) throw new Error('homePage not found — nothing to migrate')
if (home.pageBuilder) {
  console.log('homePage already migrated, skipping')
} else {
  mutations.push({
    patch: {
      id: 'homePage',
      set: {
        pageBuilder: [
          {
            _key: key(),
            _type: 'hero',
            heading: home.heading,
            statement: home.statement,
            body: home.body,
            image: home.charm,
            imagePosition: 'rechts',
            actions: home.actions,
          },
        ],
      },
      unset: ['heading', 'statement', 'body', 'charm', 'actions'],
    },
  })
}

// 2. Each legalPage becomes a page holding one richText block. The kicker has
//    no home on any block, and dropping it silently would lose
//    "Angaben gemäß § 5 DDG" — so it is prepended to the body as a paragraph.
const legal = await client.fetch<any[]>('*[_type == "legalPage"]')
const pageIds: Record<string, string> = {}

for (const doc of legal) {
  const oldSlug = doc.slug?.current as string
  const newSlug = SLUGS[oldSlug] ?? oldSlug
  const id = crypto.randomUUID()
  pageIds[newSlug] = id

  const kickerBlock = doc.kicker
    ? [
        {
          _key: key(),
          _type: 'block',
          style: 'normal',
          markDefs: [],
          children: [{_key: key(), _type: 'span', text: doc.kicker, marks: []}],
        },
      ]
    : []

  mutations.push({
    create: {
      _id: id,
      _type: 'page',
      title: doc.title,
      slug: {_type: 'slug', current: newSlug},
      pageBuilder: [
        {
          _key: key(),
          _type: 'richText',
          content: [...kickerBlock, ...(doc.body ?? [])],
          width: 'schmal',
        },
      ],
    },
  })
}

// 3. The nav LEGAL_PAGE_NAV_QUERY used to derive becomes explicit.
mutations.push({
  patch: {
    id: 'siteSettings',
    set: {
      footerLinks: ['impressum', 'datenschutz']
        .filter((slug) => pageIds[slug])
        .map((slug) => ({
          _key: key(),
          _type: 'navLink',
          page: {_type: 'reference', _ref: pageIds[slug]},
        })),
    },
  },
})

console.log(JSON.stringify(mutations, null, 2))

if (!APPLY) {
  console.log(`\nDry run — ${mutations.length} mutations, nothing written.`)
  console.log('Re-run with MIGRATE_APPLY=1 to apply.')
} else {
  await client.transaction(mutations as any).commit()
  console.log(`\nApplied ${mutations.length} mutations.`)
}
```

Add the script to `seed/package.json`:

```json
"migrate": "node --env-file=../.env --env-file=../.env.local migrate.ts"
```

The `legalPage` documents are deliberately **not** deleted here. Delete them by hand in the Studio after Step 6 confirms the new pages render — an irreversible delete does not belong in the same run that creates its replacement.

- [ ] **Step 3: Rewrite the privacy copy, in German, truthfully**

The current text at `seed/seed.ts:209` says fonts and images are served from this site's own server. Fonts are; images come from `cdn.sanity.io`. The replacement states: no cookies are set, no analytics are used, fonts are self-hosted, and images are delivered by Sanity's CDN — naming Sanity as the processor (`Sanity.io, Sanity AS, Oslo, Norwegen`) and noting that the visitor's IP address is transmitted to it when an image loads.

Keep the imprint's `[street and number]` / `[postcode and city]` placeholders exactly as they are. The placeholder test fails the build while they are present, deliberately, and that is what blocks launch until the owner supplies the address.

- [ ] **Step 4: Add redirects for the old English slugs**

Create `site/public/_redirects` — Cloudflare Workers static assets read it from the output root:

```
/imprint /impressum 301
/privacy /datenschutz 301
```

- [ ] **Step 5: Dry-run the migration**

Run: `pnpm --filter seed migrate`
Expected: prints every mutation, writes nothing. Read the output in full before continuing.

- [ ] **Step 6: Apply it**

Run: `MIGRATE_APPLY=1 pnpm --filter seed migrate`
Expected: exits 0. Open the Studio and confirm Startseite shows one Aufmacher block holding the old content, and two Seiten exist.

- [ ] **Step 7: Delete the `legalPage` type and group the legal pages in the structure**

Now that the new pages are confirmed, delete the two `legalPage` documents in the Studio, then delete `studio/schemaTypes/legalPage.ts` and its registration. Rewrite `studio/structure.ts` to the German shape from spec §5 — `Website-Einstellungen`, `Startseite`, divider, `Seiten` (pages excluding the two legal slugs), `Rechtliches` (filtered to `impressum` and `datenschutz`):

```ts
      S.listItem()
        .title('Rechtliches')
        .icon(DocumentTextIcon)
        .child(
          S.documentList()
            .title('Rechtliches')
            .filter('_type == "page" && slug.current in $slugs')
            .params({slugs: LEGAL_SLUGS}),
        ),
```

with `const LEGAL_SLUGS = ['impressum', 'datenschutz']` at module scope, and the `Seiten` list using `!(slug.current in $slugs)`.

- [ ] **Step 8: Verify and deploy all three Workers**

```bash
pnpm verify
pnpm build:site && pnpm --filter site exec wrangler deploy
pnpm --filter site build:preview && pnpm --filter site exec wrangler deploy --config wrangler.preview.jsonc
pnpm build:studio && pnpm --filter studio exec wrangler deploy
```

Then check `https://softmess.de/imprint` redirects to `/impressum`, and that `https://studio.softmess.de/presentation` still previews correctly.

- [ ] **Step 9: Commit**

```bash
git add seed site/public/_redirects studio site/test
git commit -m "feat(content): migrate to the page builder, in German, with a truthful privacy policy"
```

---

## Task 11: The usability checkpoint

**This is the gate the rest of the project waits behind.** It answers the only assumption in this design that cannot be recovered from cheaply, and every prior plan tested it last.

**Files:**
- Create: `docs/superpowers/notes/2026-XX-XX-usability-session.md` (dated the day it runs)

- [ ] **Step 1: Confirm what the owner's undo actually is**

Check the project's document-history retention on the current plan before the session — it is her only undo, and open item §10.4 of the spec has never been answered. Answer it in the notes file.

- [ ] **Step 2: Run the session**

The owner sits at `pnpm dev` — or at `studio.softmess.de/presentation`, which is now real — and attempts four tasks unaided and unprompted. The developer watches **silently** and takes notes. Silence is the method; a hint invalidates the result.

1. Add a new page and give it a sensible address.
2. Make that page reachable from the site's navigation.
3. Reorder two blocks on the home page.
4. Replace a photo.

- [ ] **Step 3: Watch for the five known traps**

| Trap | Prepared fix |
| --- | --- |
| Umlaut in a slug fails validation | Already built — Task 4's `slugifyGerman` |
| Page published but linked from nowhere | Already built — Task 7's orphan warning |
| Edits autosave as a draft; she never presses Publish | The most common first-time-Sanity failure. Has no prepared fix; may need a Studio affordance |
| Partial German in Studio chrome | The bar is "nothing she routinely touches is in English" |
| No visible undo | Document history; retention answered in Step 1 |

- [ ] **Step 4: Write up the outcome and decide what follows**

- She succeeds → the remaining work is the publishing automation follow-up plan, and reload-free preview stays declined.
- She struggles **on preview specifically** → that is the evidence that would reopen the Next.js question in spec §2. Nothing else is.
- She struggles **on the Studio itself** → no frontend would have helped; the fix is in the schema.

- [ ] **Step 5: Commit the notes**

```bash
git add docs/superpowers/notes
git commit -m "docs: record the usability session outcome"
```

---

## Out of scope — the follow-up plan

Written after Task 11, because its shape depends on the outcome:

- **Publishing automation (spec §7.3):** Sanity webhook → GitHub `repository_dispatch` → build → `wrangler deploy` of the static site only, filtered to published documents of the types that affect the public site.
- **Three CI deploy jobs (spec §7):** `deploy-site`, `deploy-preview`, `deploy-studio`, replacing the manual `wrangler deploy` commands this plan uses throughout. Actions SHA-pinned, per the convention in `.github/workflows/verify.yml`.
- **`verify:live` (spec §9):** the draft-leak assertion run against the deployed preview hostname, which needs secrets and so cannot live in the offline `pnpm verify`.
- **Proxying `cdn.sanity.io` through our own origin (spec §8):** recorded as a want, not a plan.

## Owner-blocked items

None of these block the tasks above, but all block launch:

1. **Imprint address.** `[street and number]` and `[postcode and city]`. A `§ 5 DDG` imprint without an address is not compliant, and the placeholder test fails the build while they are present — deliberately.
2. **DPA with Sanity.** Naming a processor in a privacy policy without an Auftragsverarbeitungsvertrag on file is the wrong half of the fix.
3. **German copy.** Every string needs a German original; the migration carries over what exists.
