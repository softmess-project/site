# softmess.de on Next.js — foundation design

Date: 2026-08-16
Status: **superseded by `2026-08-16-page-builder-design.md`** — not implemented.

Rejected after adversarial review established that the page builder is a Sanity
Studio feature requiring no replatform, leaving reload-free preview as the sole
justification — which the owner weighed and declined.

Kept for its measurements (§2), which are stack-independent and were expensive to
obtain, and for two errors worth not repeating. **§6 is wrong**: draft-mode
cookies do not bypass Workers Cache, because cookies are not in the cache key and
lookup precedes Worker execution — `Vary: Cookie` is required. **§3 is wrong**: a
`[slug]` route without `generateStaticParams` renders dynamic and is never
cached, so only `/` was ever cacheable. §5.1 also describes React's
`useOptimistic`; Sanity's is a different, reducer-based hook from
`next-sanity/hooks`.

Replatform the site from Astro to Next.js on Cloudflare Workers, so that the
site's owner composes and publishes pages herself, in German, with a preview that
updates as she types — and so the foundation supports a product catalogue later
without a rewrite.

This supersedes `2026-08-15-visual-editing-design.md` and
`2026-08-16-nextjs-page-builder-design.md` in full. It retires one goal from
`2026-08-15-softmess-site-design.md` §1 ("The public site ships no client-side
JavaScript") and replaces its two-static-Worker architecture.

## 1. Goals and non-goals

**Goals**

- The owner composes pages from blocks, reorders them by dragging, and adds new
  pages with their own slugs and navigation entries — without a developer.
- Editing a field updates the preview in place, with no full page reload.
- Publishing takes effect immediately: no rebuild, no deploy, no CI round-trip.
- The site is German throughout, including the Studio she works in.
- Blocks expose curated layout variants, not arbitrary styling. The site should
  not be capable of looking broken.
- Public traffic should invoke the Worker as rarely as possible.
- A product catalogue must later be additive, not a refactor.
- The privacy policy must be true.

**Non-goals**

- No shop, cart, accounts, checkout, or analytics. `shop.softmess.de` stays out
  of scope.
- No localisation machinery. The site is German; there is no second language.
- No product catalogue in this project — only the decisions that keep it cheap
  to add (§4.4).
- No custom Visual Editing overlay components. The API is experimental and we
  do not need it.

**Retired goal.** The original design promised zero client-side JavaScript. Next
ships a React runtime regardless of how a page is written. This is the price of
the editing experience, it is not recoverable by configuration, and it is taken
deliberately rather than discovered later. §5.1 claws back part of what that goal
was protecting by keeping public pages free of the editing-only client code.

## 2. Spike findings

Everything in §3 rests on measurements taken on 2026-08-16 against a throwaway
`@opennextjs/cloudflare` app deployed to `*.workers.dev` and since deleted. They
are recorded because several contradict what was assumed beforehand.

| Question | Measured |
| --- | --- |
| OpenNext bundle size | **1.51 MB gzip** (7.63 MB raw). Fits the free plan's 3 MB and the paid plan's 10 MB. Not a constraint. |
| Worker startup time | 26 ms, against a 1 s limit |
| CPU per SSR render | **25–319 ms**, median 223 ms, over five cold and warm invocations |
| Does Workers Cache skip the Worker? | **Yes.** 5 cached requests → 0 invocations; 5 cache-busted requests → 5 invocations |
| `<SanityLive />` outside draft mode | No error, locally or on the edge, with no tag cache configured |
| `browserToken` leakage | Canary token absent from rendered HTML and from every static chunk |

Three consequences:

**The free plan cannot host this, at any bundle size.** Its cap is 10 ms CPU per
invocation; the *warmest* measured render was 25 ms and the median 223 ms. The
bundle was never the binding constraint. Workers Paid is $5/month, is
**account-level** rather than per-Worker, and includes 10M requests and 30M
CPU-ms. The account already carries it — the 319 ms invocation returned `ok`,
which the free plan would have killed.

**OpenNext does not emit static HTML.** Next reports `/` as statically
prerendered, but the HTML lands in `.open-next/cache/<buildId>/index.cache` and
is served *through the Worker*. Only `_next/static/*` and `BUILD_ID` become real
assets. Serving public pages as free static assets would require
`output: 'export'`, which disables SSR, draft mode and route handlers in that
build — meaning two separate builds of one app.

**Workers Cache makes that unnecessary.** `"cache": { "enabled": true }` puts a
cache in front of the Worker; on a hit the Worker does not run and no CPU is
billed. OpenNext already emits `Cache-Control: s-maxage=31536000` on prerendered
pages, so it applies with no application change.

## 3. Architecture

Two Workers, as today. The Studio is never served from the visitor-facing
hostname.

```
  Visitor → Cloudflare edge
              ├─ HIT  → cached HTML, Worker never runs, 0 CPU, ~60 ms   ← ~all public traffic
              └─ MISS → Worker: SSR against Sanity (~250 ms CPU), cached, served

  Editor  → Presentation → same Worker, draft-mode cookie
              → response is `private, no-store` → bypasses cache → fresh SSR
              → <SanityLive /> + <VisualEditing />

  Publish → Sanity webhook → /api/purge → cache.purge({tags: ['site']})
              → next visitor re-renders once; no rebuild, no deploy


  softmess.de          Next.js 16 App Router on Workers   ← @opennextjs/cloudflare
  www.softmess.de      SSR + Workers Cache                  Workers Paid, $5/mo (account-level)

  studio.softmess.de   Sanity Studio, standalone SPA      ← unchanged apart from §7
                       static assets, no Worker code

  Sanity Content Lake  free plan, public dataset          ← unchanged
```

### 3.1 Why one site Worker, not a separate preview deployment

Draft mode serves previews from the production Worker, and draft responses are
uncacheable, so they bypass Workers Cache without special-casing. A separate
`preview.softmess.de` would duplicate a deployment to gain nothing.

A **staging** Worker is still worth having, but for reviewing code changes before
they reach the live domain — a different job from content preview, and not on the
critical path for this project.

### 3.2 Why the Studio stays standalone

`sanity build` on Vite is far faster than compiling the Studio through
`next build`; standalone Studios auto-update without a dependency bump; and
TypeGen watch mode only works under `sanity dev`, which this repo's workflow
depends on. Sanity's own guidance is that a standalone Studio is recommended for
new Next.js projects. `studio/` therefore changes only as §7 describes.

### 3.3 No ISR, no incremental cache

SSR routes work on OpenNext with no caching configuration. ISR would require an
R2 incremental cache, a D1 or Durable Object tag cache and a DO queue. Workers
Cache already keeps public traffic off the Worker, which is what ISR would have
been for. At this site's size the remaining CPU cost — one render per purge per
PoP, ~250 ms — sits far inside the 30M CPU-ms the $5 plan includes.

### 3.4 Repository layout

`site/` keeps its name and becomes the Next app; `studio/` and `seed/` keep
theirs. Keeping directory names avoids churn in the workspace file, both wrangler
configs, and CI.

## 4. Content model

### 4.1 Studio language

Schema **field names stay English** — they are code and they appear in GROQ.
Everything the owner sees is German: field titles, descriptions, validation
messages, and the Studio chrome itself via `@sanity/locale-de-de`. She should not
encounter an English word while editing.

### 4.2 Documents

| Type | Change | Why |
| --- | --- | --- |
| `siteSettings` | singleton; gains `headerLinks[]`, `footerLinks[]`, field groups | Grows past a dozen fields; groups keep it navigable |
| `homePage` | keeps its singleton id; fields replaced by `pageBuilder[]` | A singleton cannot be accidentally deleted — worth protecting for the one page that must exist |
| `page` | **new** — `title`, `slug`, `pageBuilder[]`, `seo` | Lets her add `/ueber-uns` without a developer |
| `legalPage` | **deleted**, converted to `page` | See below |

**`legalPage` is merged into `page`.** Three complexities existed only because
there were two types sharing one URL namespace: a cross-type slug uniqueness
rule, a two-branch `/[slug]` route that tried one type then fell back, and nav
links that had to reference either type. Merging deletes all three, and a
non-developer sees one concept — a page — instead of two. The rigidity a separate
type appeared to buy was illusory: the imprint body was already freely editable.
What actually protects the imprint is the placeholder test in §9, which is
type-independent. In the Studio the legal pages remain visibly separate through a
structure filter (§7), not a separate type.

Navigation becomes explicit. A nav link is an object with either an internal
reference or an external URL, plus an optional label override. This replaces
`LEGAL_PAGE_NAV_QUERY`, which auto-listed every legal page sorted by title — a
behaviour she gains control over.

### 4.3 Blocks

Five to start. Sanity's documented failure mode for page builders is *too many
block types*; this set grows on demand rather than in anticipation.

| Block | Fields | Variants |
| --- | --- | --- |
| `hero` | Überschrift, Statement, Text, Bild, Aktionen | Bild links / rechts |
| `richText` | Portable Text | schmal / breit |
| `imageText` | Bild, Überschrift, Text, Aktionen | Bild links / rechts · Hintergrund normal / sand / akzent |
| `gallery` | Bilder[] mit Alt-Text | 2 / 3 Spalten |
| `cta` | Überschrift, Text, Aktionen | Hintergrund normal / akzent |

The existing `action` object type is reused unchanged.

Every block carries a `@sanity/icons` icon and a `preview.prepare` returning its
own heading as `title`, the block type's German name as `subtitle`, and its image
as `media` (falling back to the icon). Consistent previews are what make a
collapsed array of blocks legible.

`pageBuilder` sets `options.insertMenu.views` to a `grid` with `previewImageUrl`,
so adding a block is picking a thumbnail rather than choosing from a dropdown of
type names. Thumbnails live in `site/public/block-previews/<type>.png`.

Three conventions, none optional:

- **Variants are strings, and every one passes through `stegaClean` before it is
  compared or mapped to a class.** Stega characters break string equality, so an
  uncleaned variant silently falls through to the default — a bug that appears
  only in preview, which is the worst place for it.
- **Heading levels are never stored.** Storing `h1`/`h2` in content breaks
  accessibility. `PageBuilder` passes a `semanticLevel` prop: `h1` for the first
  block on a page, `h2` thereafter.
- **`key={block._key}`, never an array index.** An index key breaks Visual
  Editing and causes hydration mismatches.

### 4.4 What keeps the catalogue additive

Three decisions taken now so that a `product` type is a pure addition:

1. **Slug namespace reserved.** Pages live at `/<slug>`; products will live at
   `/produkte/<slug>`. `produkte` is a forbidden page slug from day one —
   otherwise adding products later is a breaking URL change.
2. **Slug uniqueness** is validated with a rule written to extend to further
   document types, not hardcoded to one.
3. **Nav links reference a document, not a type-specific field.** Adding
   `product` to the allowed reference types is one line, and a future
   `productList` block slots into `pageBuilder` without touching any existing
   block.

## 5. Rendering

```
site/src/
├── app/
│   ├── layout.tsx                    # lang="de", <SanityLive/>, <VisualEditing/> in draft
│   ├── page.tsx                      # homePage singleton
│   ├── [slug]/page.tsx               # page (incl. impressum, datenschutz)
│   ├── not-found.tsx
│   └── api/
│       ├── draft-mode/enable/route.ts
│       └── purge/route.ts
├── components/
│   ├── PageBuilder.tsx
│   ├── blocks/{Hero,RichText,ImageText,Gallery,Cta}.tsx
│   └── {Header,Footer,Prose}.tsx
└── sanity/
    └── {client,live,queries,image}.ts
```

`lib/image.ts` and the Tailwind theme in `styles/theme.css` port unchanged — the
`--spacing: 4.4px` alignment and the `charm-blob`, `washed` and `drift` utilities
are stack-independent. `astro-portabletext` becomes `@portabletext/react`; the
component map keeps its shape. Fonts stay self-hosted via `@fontsource`.

Block props are typed with `Extract<…, {_type: 'hero'}>` off the generated query
types, so schema drift surfaces as a type error rather than a blank section.

### 5.1 The optimistic wrapper is draft-mode only

`PageBuilder` needs to be a client component for `useOptimistic` to apply a
drag-reorder before the mutation round-trips; without it she waits 200–500 ms per
drag. That is only worth paying for while editing, so the optimistic client
wrapper renders **only in draft mode**, and public pages render the block list as
pure server components. She gets an instant drag; visitors get less JavaScript.

### 5.2 Data fetching

`defineLive` from `next-sanity/live`, per Sanity's default recommendation — it
handles fetching, caching and invalidation, and Visual Editing works
automatically. `useCdn: true` for runtime reads.

The `SANITY_FIXTURES` branch in `site/src/lib/sanity.ts` is deleted. It existed
so the Astro build could produce HTML without network access; an SSR app fetches
nothing at build time. The fixtures themselves survive, repurposed as component
test data (§9).

### 5.3 Dependency pin

`next-sanity@13` peers `@sanity/client@^7.26.2` while the current release is
`^8`. The site pins `^7`. This conflict has recurred at every step of this
project; pin rather than fight it.

## 6. Preview and caching

| Piece | Implementation |
| --- | --- |
| Enable preview | `defineEnableDraftMode` at `/api/draft-mode/enable` |
| Preview state | Next's own `draftMode()` |
| Overlays | `<VisualEditing />`, rendered only in draft mode |
| Live updates | `<SanityLive />` in the root layout |
| Tokens | `serverToken` / `browserToken` on `defineLive`, from `SANITY_API_READ_TOKEN` |
| Edge cache | `"cache": { "enabled": true }` in `site/wrangler.jsonc` |
| Invalidation | Every page response carries `Cache-Tag: site`, set once via `headers()` in `next.config.ts`; a Sanity webhook calls `/api/purge`, which calls `cache.purge({tags: ['site']})` imported from `cloudflare:workers` |

**One tag, purge everything.** The site has a handful of pages and publishes a
few times a month. Per-page tags would mean mapping documents to the routes they
appear on — `siteSettings` alone affects every page — for no benefit at this
size. Add precision only if it ever hurts.

**Draft mode bypasses the cache without special-casing.** Draft responses carry
`private, no-store`, and Workers Cache follows RFC 9111.

**`/api/purge` is authenticated with a shared secret**, so it cannot be used from
outside to force re-renders.

**This is the highest-risk wiring in the design.** The one-year `s-maxage` means
that if the purge webhook is missing or misconfigured, published content silently
never reaches visitors: the page renders fine, it is simply permanently stale.
That failure is invisible to every test that does not look for it specifically,
which is why §9 has one that does.

## 7. Studio changes

```
Inhalt
├─ Website-Einstellungen     singleton → siteSettings   (groups: Marke, Navigation, 404, SEO)
├─ Startseite                singleton → homePage
├─ ─────────
├─ Seiten                    page, excluding the legal two
└─ Rechtliches               page, filtered to impressum + datenschutz
```

- `presentationTool({resolve, previewUrl: {previewMode: {enable: '/api/draft-mode/enable'}}})`
  joins `structureTool` and `visionTool`.
- `resolve.locations` maps `homePage` → `/`, `page` → `/{slug}`, and
  `siteSettings` → every page, labelled "Jede Seite", so editing the brand shows
  what it affects.
- `@sanity/locale-de-de` added to plugins.
- `autoUpdates: false` stays: a self-contained bundle we deploy ourselves, with
  no runtime dependency on a third-party origin.
- TypeGen config changes one line — the glob picks up `.tsx` instead of `.astro`.

## 8. German copy, slugs, and the privacy fix

Content becomes German, the document element becomes `<html lang="de">`, and
slugs become `impressum` and `datenschutz`. **`/imprint` and `/privacy` get
redirects** so existing links do not 404.

**The privacy policy is rewritten because it is currently false.** `seed/seed.ts`
publishes *"fonts and images are served from this site's own server."* Fonts are;
images are not — they come from `cdn.sanity.io`, and the existing test suite
explicitly exempts that origin. A German site carrying a `§ 5 DDG` imprint should
not make a false statement about a third-party origin that sees every visitor's
IP. The German replacement states that no cookies are set, no analytics are used,
fonts are self-hosted, and images are delivered by Sanity's CDN, naming Sanity as
the processor.

### 8.1 Migration script

In `seed/`, following the existing `SEED_REPLACE` gating, plus a **dry-run mode
that prints every mutation without applying it** — so the conversion is
reviewable before it touches content, without depending on whether the Sanity
plan permits a second dataset:

1. `homePage`'s `heading` / `statement` / `body` / `charm` / `actions` → a single
   `hero` block in `pageBuilder`.
2. The two `legalPage` documents → `page` documents holding one `richText` block,
   with German slugs.
3. The nav currently implied by `LEGAL_PAGE_NAV_QUERY` → explicit `headerLinks`
   and `footerLinks` on `siteSettings`.

## 9. Testing

The current suite builds to `dist/` and asserts over the HTML with `linkedom`,
offline and secretless so that fork PRs work. SSR has no `dist/`, so that
mechanism goes — but the assertions it encoded must survive, because they guard
promises the site makes in its own legal text.

| Check | Command |
| --- | --- |
| `next build`, `tsc --noEmit`, eslint | `pnpm verify` |
| TypeGen drift (`git diff --exit-code`) | `pnpm verify` — mechanism unchanged |
| Blocks render from fixtures: actions, variants, Portable Text | `pnpm verify` |
| No `[`-bracketed placeholder survives into rendered output | `pnpm verify` |
| No subresource from any origin but self or `cdn.sanity.io` | `pnpm verify` |
| Routes resolve, 404 works, redirects fire | `pnpm verify:live` |
| **Publish → purge → new content is served** | `pnpm verify:live` |
| Bundle under the Worker size limit | deploy job |

`pnpm verify` stays offline and secretless. `verify:live` needs Sanity and a
running `wrangler dev`; it runs in the deploy job and on demand.

**Retired:** *"no `<script>` tag is emitted by the site build."* Next ships a
React runtime. A test that cannot pass gets deleted under pressure later, so it
goes now, deliberately, alongside the goal it enforced.

## 10. Migration and cutover

Content and deployment migrate independently; neither is a big bang.

1. **Build alongside.** The Next app deploys to a staging Worker on a
   `*.workers.dev` subdomain. `softmess.de` continues to serve the Astro Worker.
   Nothing user-facing changes. After cutover this Worker is kept as the
   permanent staging target described in §3.1, not deleted.
2. **Migrate content** — dry-run, review the mutations, then apply.
3. **Review.** She composes the real home page in Presentation against staging.
4. **Cut over.** Move the `softmess.de` and `www.softmess.de` custom domains to
   the new Worker. Rollback is moving them back; the Astro Worker stays deployed
   and untouched for a grace period.
5. **Retire.** Delete the Astro Worker, its wrangler config, the
   `repository_dispatch` trigger and the publish→rebuild webhook. With
   cache-purge publishing there is nothing to rebuild.

CI: `deploy-site` builds through `opennextjs-cloudflare` instead of
`astro build`; the `repository_dispatch` trigger is deleted; `deploy-studio` is
unchanged.

## 11. Open items

1. **DPA with Sanity.** Naming a processor in a privacy policy without an
   Auftragsverarbeitungsvertrag on file is the wrong half of the fix. Required
   before the rewritten policy is published. **Owner action.**
2. **Imprint address.** `[street and number]` and `[postcode and city]` are still
   placeholders, and the placeholder test fails the build while they are present
   — deliberately. **Owner action, blocks launch.**
3. **Workers Cache maturity.** The feature is days old; the `cache` field is not
   yet in wrangler 4.123.0's published JSON schema, though wrangler accepts it.
   Blast radius is one config line and the fallback is removing it, at which
   point the Worker serves every request itself. Verify purge-by-tag, draft-mode
   bypass, and behaviour on a real custom domain during implementation.
4. **German copy.** Every string on the site needs a German original. The owner
   writes them; the migration script seeds placeholders otherwise.
5. **Redirects.** Confirm `/imprint` and `/privacy` redirect correctly through
   Workers Cache rather than being cached as their pre-redirect responses.

## 12. Decision log

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| Next.js + OpenNext on Cloudflare | Next.js on Vercel | Vercel's Hobby tier is non-commercial; Pro is 4× the budget. Cloudflare is where the zone already lives |
| SSR + Workers Cache | `output: 'export'` + separate SSR preview Worker | Same "Worker rarely runs" outcome for one config line, and keeps instant publishing instead of rebuilds |
| SSR + Workers Cache | ISR with R2 + D1 + DO queue | Workers Cache already achieves the goal; ISR reintroduces the infrastructure it would replace |
| Cache purge on publish | Rebuild + redeploy on publish | Milliseconds instead of ~40 s, and deletes the whole webhook→CI→deploy chain |
| One tag, purge everything | Per-page cache tags | `siteSettings` affects every page; precision buys nothing at this size |
| `legalPage` merged into `page` | Keep two document types | Deletes cross-type slug validation, a two-branch route, and dual nav reference types; the rigidity it appeared to buy was illusory |
| Studio stays standalone | Embed at `softmess.de/studio` | Faster builds, auto-updates, TypeGen watch; Studio can never leak onto the marketing host |
| One site Worker | Separate `preview.softmess.de` | Draft mode previews from production and bypasses the cache; a second deployment gains nothing |
| Draft-mode-only optimistic wrapper | Always a client component | Instant drag while editing, less JavaScript for visitors |
| German-only | Bilingual DE/EN | The audience is German; the current English/German mix is an accident, not a decision |
| Five blocks | A larger starter set | Sanity's documented failure mode is too many block types |
| `/produkte/<slug>` reserved now | Decide when products arrive | Retrofitting a URL namespace is a breaking change |
| Rewrite the privacy copy | Proxy images through our origin | Sanity is the processor either way; proxying costs CPU and bandwidth on every image for no real gain |
| Workers Paid accepted | Optimise for the free plan | Free caps CPU at 10 ms; the warmest measured render was 25 ms. Free cannot host this at any bundle size |
