# Next.js page builder — design

Date: 2026-08-16
Status: **superseded by `2026-08-16-nextjs-foundation-design.md`** — never implemented.

Kept for its reasoning, not as a plan. It was written before the spike in that
document's §2, and several of its load-bearing assumptions turned out to be
wrong: SSR-on-every-request was replaced by Workers Cache, `legalPage` was merged
into `page`, and the site is German-only. Read the superseding spec instead.

Replatform the site from Astro to Next.js so that the site's owner can compose and
publish pages herself, with live preview that updates as she types.

This supersedes `2026-08-15-visual-editing-design.md` in full. That design added
click-to-edit overlays to the Astro site and explicitly deferred both page building
and reload-free preview (§7) — which turn out to be the two requirements that matter.
It also retires one goal from `2026-08-15-softmess-site-design.md` §1: "The public
site ships no client-side JavaScript." See §1.

## 1. Goals and non-goals

**Goals**

- The owner composes pages from blocks, reorders them by dragging, and adds new pages
  with their own slugs and navigation entries — without a developer.
- Editing a field updates the preview in place, with no full page reload.
- Publishing takes effect immediately, with no rebuild and no deploy.
- Blocks expose curated layout variants, not arbitrary styling. The site should not
  be capable of looking broken.
- Runs for about $5/month, all in.

**Non-goals**

- No shop, accounts, or analytics. `shop.softmess.de` remains out of scope.
- No localisation.
- No custom overlay components — the API is experimental and we don't need it.

**Retired goal.** The original design promised zero client-side JavaScript. Next.js
ships a React runtime on every page (~90KB gzipped) regardless of how the page is
written. This is the price of the editing experience, it is not recoverable by
configuration, and it should be a conscious trade rather than a surprise. Nothing
else about the site's performance profile changes: pages still render server-side and
still serve images from Sanity's CDN.

## 2. Architecture

Three deployments, as today. Only the site Worker changes.

```
  softmess.de          Next.js 16 App Router on Workers      ← @opennextjs/cloudflare
                       SSR, no ISR, no cache bindings          Workers Paid, $5/mo

  studio.softmess.de   Sanity Studio, standalone SPA         ← unchanged
                       + presentationTool

  Sanity Content Lake  free plan, public dataset             ← unchanged
```

### 2.1 Hosting

`@opennextjs/cloudflare@1.20` supports App Router, SSR, route handlers, draft mode,
server actions and ISR. Only Node-in-middleware is unsupported, which we don't use.

The Workers **Paid** plan is required, not a preference: the free plan caps CPU at
10ms per request and worker scripts at 3MB compressed. React server rendering exceeds
the former routinely and an OpenNext bundle sits close to the latter. Paid raises
these to 30s and 10MB.

**No ISR, deliberately.** SSR routes "work out of the box without any caching config"
on OpenNext, whereas ISR and on-demand revalidation would require an R2 incremental
cache, a D1 or Durable Object tag cache, and a DO queue. At this site's traffic,
rendering every request against Sanity's CDN is both cheaper and simpler, and it removes
the entire publish-webhook-rebuild mechanism that exists today.

### 2.2 Studio stays standalone

Sanity's guidance is explicit that a standalone Studio is recommended for all new
Next.js projects and an embedded Studio is not: `sanity build` on Vite is 10–30×
faster than compiling the Studio through `next build`; standalone Studios auto-update
without a dependency bump or redeploy; and TypeGen watch mode only works under
`sanity dev`, which this repo's workflow depends on.

So `studio/` and `studio.softmess.de` are untouched by this work, apart from schema
additions (§4) and the Presentation tool (§6).

### 2.3 Repository layout

`site/` keeps its name and becomes the Next.js app; `studio/` and `seed/` are
unchanged. Keeping the directory name avoids churn in the workspace file, the
wrangler configs and CI.

## 3. Content model

### 3.1 Documents

| Type | Change | Why |
| --- | --- | --- |
| `homePage` | keeps its singleton id, fields replaced by `pageBuilder[]` | A singleton can't be accidentally deleted — worth protecting for the one page that must exist |
| `page` | **new**: `title`, `slug`, `pageBuilder[]`, `seo` | Lets her add `/about` without a developer |
| `legalPage` | unchanged | Rigid, formulaic content. Sanity's guidance is explicitly not to use a page builder for these |
| `siteSettings` | gains `headerLinks[]`, `footerLinks[]`; `notFound` and `seo` kept | Nav becomes explicit instead of "every legal page, sorted by title" |

Nav links are an object with either an internal reference (`page` or `legalPage`) or
an external URL, plus an optional label override. This replaces the current
`LEGAL_PAGE_NAV_QUERY`, which auto-listed legal pages — a behaviour change she gains
control over.

`page.slug` and `legalPage.slug` share a namespace and must not collide. Both get a
uniqueness validation rule that checks across both types.

### 3.2 Blocks

Five to start. The documented pitfall is "paradox of choice" and "too many block
variations", so this set is deliberately short and grows on demand.

| Block | Fields | Variants |
| --- | --- | --- |
| `hero` | heading, statement, body, image, actions[] | image left / right |
| `richText` | Portable Text | width narrow / wide |
| `imageText` | image, heading, body, actions[] | image left / right; background default / surface / accent |
| `gallery` | images[] with alt | columns 2 / 3 |
| `cta` | heading, body, actions[] | background default / accent |

The existing `action` object type is reused unchanged for every block that has
buttons.

Every block follows the same conventions: an icon from `@sanity/icons`, and a
`preview.prepare` returning `title` (the block's own heading), `subtitle` (the block
type's human name) and `media` (its image, falling back to the icon). Consistent
previews are what make the Studio's array of blocks legible when collapsed.

The `pageBuilder` array sets `options.insertMenu.views` to a `grid` with
`previewImageUrl`, so adding a block is a visual choice from thumbnails rather than a
dropdown of type names. Thumbnails live in `site/public/block-previews/<type>.png`.

**Variants are strings with a radio layout**, and every one of them must be passed
through `stegaClean` before it is compared or mapped to a class. Stega characters
break equality, so an uncleaned variant silently falls through to the default — a
bug that only appears in preview, which is the worst place for it.

**Heading levels are not stored.** Sanity's guidance is explicit: storing `h1`/`h2`
in the schema breaks accessibility. `PageBuilder` passes a `semanticLevel` prop —
`h1` for the first block on a page, `h2` thereafter.

## 4. Rendering

### 4.1 Structure

```
site/src/
├── app/
│   ├── layout.tsx              # <SanityLive />, <VisualEditing /> in draft mode
│   ├── page.tsx                # homePage singleton
│   ├── [slug]/page.tsx         # page, falling back to legalPage
│   ├── not-found.tsx
│   └── api/draft-mode/enable/  # defineEnableDraftMode from next-sanity
├── components/
│   ├── PageBuilder.tsx         # client component — see §4.2
│   └── blocks/                 # one file per block
└── sanity/
    ├── client.ts, live.ts, queries.ts, image.ts
```

`PageBuilder` switches on `block._type` and renders with `key={block._key}` — never
an array index, which breaks Visual Editing and causes hydration mismatches. Block
props are typed with `Extract<…, {_type: 'hero'}>` from the generated query types, so
schema drift surfaces as a type error rather than a runtime blank.

The existing `lib/image.ts` and the Tailwind theme in `styles/theme.css` port
unchanged. `astro-portabletext` becomes `@portabletext/react@8`; the component map
keeps the same shape.

### 4.2 Drag-and-drop reordering

The array container must render on the client for `useOptimistic` to work, so
`PageBuilder` is a client component and blocks hydrate with it. They are
presentational, so this is cheap. The container and each child carry `data-sanity`
attributes built with `createDataAttribute`, and `useOptimistic` applies the reorder
locally the moment the editor drops a block, before the mutation round-trips.

### 4.3 Data fetching

`defineLive` from `next-sanity/live`, per Sanity's default recommendation — it
handles fetching, caching and invalidation, and Visual Editing works automatically.
Every GROQ query in today's `lib/content.ts` ports verbatim; only the page-builder
projection is new, and it expands references only for blocks that need them.

`useCdn: true` for runtime reads, `false` in `generateStaticParams` and anywhere
freshness is required.

The `SANITY_FIXTURES` branch and `test/fixtures/` are deleted. They existed so the
Astro build could produce HTML without network access; an SSR app fetches nothing at
build time, so the machinery has no purpose.

## 5. Preview and live editing

Entirely canonical, with no bespoke mechanism — this is the payoff for changing stacks.

| Piece | Implementation |
| --- | --- |
| Enable preview | `defineEnableDraftMode` from `next-sanity/draft-mode` at `/api/draft-mode/enable` |
| Preview state | Next's own `draftMode()` |
| Overlays | `<VisualEditing />` from `next-sanity/visual-editing`, rendered when draft mode is on |
| Live updates | `<SanityLive />` in the root layout |
| Tokens | `serverToken` and `browserToken` on `defineLive`, from `SANITY_API_READ_TOKEN` |

Draft mode bypasses the cache entirely — `next-sanity`'s own action warns "cache is
bypassed in draft mode so the router.refresh() function is called instead of
revalidating tags". This is why live preview needs none of the R2/D1/DO cache
infrastructure §2.1 skips: in preview it is never used.

`browserToken` is only to reach the browser while draft mode is enabled. Confirm this
holds in the built output before deploying (§9, item 2) — a read token in a public
bundle would expose every draft on the project.

## 6. Studio changes

`presentationTool({resolve, previewUrl: {previewMode: {enable: '/api/draft-mode/enable'}}})`
joins `structureTool` and `visionTool`. `resolve.locations` covers `homePage` (`/`),
`page` (`/{slug}`), `legalPage` (`/{slug}`) and `siteSettings` (`/`, labelled "Every
page").

Structure gains a "Pages" list beside the existing singletons. `siteSettings` gains
field groups — Brand, Navigation, Not found, SEO — since it grows past a dozen fields.

## 7. Migration and cutover

Content and deployment migrate independently, and neither is a big bang.

1. **Build alongside.** The Next app deploys to `preview.softmess.de` while
   `softmess.de` continues to serve the existing Astro Worker. Nothing user-facing
   changes until step 4.
2. **Migrate content.** A script in `seed/` converts the existing `homePage`
   singleton into a `pageBuilder` array — its heading/statement/charm/actions become
   one `hero` block — and writes the nav links now implied by `LEGAL_PAGE_NAV_QUERY`
   into `siteSettings`. Legal pages are untouched. It follows the existing
   `SEED_REPLACE` gating convention so it cannot destroy content by accident.
3. **Review.** She composes the real home page in Presentation against the preview
   deployment.
4. **Cut over.** Move the `softmess.de` and `www.softmess.de` custom domains from the
   `softmess` Worker to the new one. Rollback is moving them back; the Astro Worker
   stays deployed and untouched for a grace period.
5. **Retire.** Delete the Astro Worker, its wrangler config, and the publish webhook
   that triggered rebuilds — with SSR there is nothing to rebuild.

## 8. Verification

| Check | Guards |
| --- | --- |
| `next build` + `tsc --noEmit` | compiles and types |
| `pnpm typegen` + `git diff --exit-code` | generated types match the schema — mechanism unchanged |
| `eslint` | unchanged for `studio/`, new config for `site/` |
| Smoke test against `wrangler dev` | replaces `test/dist.test.ts`, which parsed built HTML that no longer exists |
| Bundle size after `opennextjs-cloudflare build` | must stay under the 10MB compressed Worker limit |
| Manual: reorder blocks in Presentation, confirm no full reload | the feature this replatform exists for |
| Manual: view source in production, no stega characters, no token | preview machinery must not leak into the public site |

## 9. Open items

1. Does `<SanityLive />` behave on Cloudflare **outside** draft mode? For public
   visitors it calls `revalidateTag`, which on OpenNext expects a tag cache we
   deliberately don't configure. If it errors rather than no-ops, render `<SanityLive />`
   only in draft mode — public pages are SSR with no data cache, so they are already
   fresh on every request and gain nothing from it.
2. Does `browserToken` reach the browser outside draft mode? (§5 — verify in the
   built bundle, before any deploy.)
3. OpenNext bundle size against the 10MB limit, and cold-start latency on Workers.
4. `next-sanity@13` peers `@sanity/client@^7` while the repo runs `^8`. This has
   recurred at every step of this project; if anything misbehaves, pin the site to
   `^7` rather than fighting it.
5. Slug uniqueness across `page` and `legalPage` (§3.1) — validate in the schema,
   confirm the message is comprehensible to a non-developer.

## 10. Deferred

**Presentation queries.** `usePresentationQuery` re-fetches only the block being
edited instead of the whole page. Worth it for pages with many blocks; this site's
pages will have five or six. Revisit if editing feels slow.

**ISR and public live content.** If traffic ever justifies caching, the path is R2 +
D1 + a DO queue, and `<SanityLive />` then gives visitors real-time updates too.

**Scheduled publishing and comments.** Sanity Growth features, $15/seat/month. Not
needed to launch.
