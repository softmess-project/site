# Sanity page builder on Astro — design

Date: 2026-08-16
Status: approved

Give the site's owner a page builder she can use without a developer — composing
pages from blocks, reordering them, adding pages with their own slugs and
navigation entries — in German, on the **existing Astro site**, and find out
whether it actually works for her before building anything further.

This supersedes `2026-08-16-nextjs-foundation-design.md`. That document designed
a Next.js replatform; §2 records why it is not being built.

## 1. Goals and non-goals

**Goals**

- The owner composes pages from blocks, reorders them, and adds pages with their
  own slugs and navigation entries — without a developer.
- The site is German throughout, including the Studio she works in.
- Blocks expose curated layout variants, not arbitrary styling. The site should
  not be capable of looking broken.
- **Establish whether she can actually do this**, early, on real content, before
  further work depends on the answer.
- **The best editing experience Sanity offers on this stack**: Presentation mode,
  fully featured — split view, click-to-edit overlays, document-location
  resolution, iframe navigation that moves the form with it, and the drafts
  perspective. The page-refresh flash is the *only* accepted compromise (§2);
  everything else Presentation provides is in scope, and the reload itself should
  be made as unobtrusive as the stack allows (§5).
- Public traffic never invokes a Worker.
- Visitors' browsers never connect to Sanity, apart from `cdn.sanity.io` for
  images.
- The privacy policy must be true.
- A product catalogue must later be additive, not a refactor.

**Non-goals**

- No replatform. See §2.
- No **reload-free** preview. The preview iframe reloads on each change; only
  removing that flash needed a full React frontend, and it was weighed and
  declined (§2). The click-to-edit overlay above does need a small React
  island of its own in the preview build only (§4) — that renders the overlay,
  not the page, and is a different, far cheaper thing than the reload-free
  rewrite that was declined. Live preview itself is a goal, above.
- No shop, cart, accounts, checkout, or analytics.
- No localisation machinery. The site is German; there is no second language.
- No product catalogue — only the decisions that keep it cheap to add (§3.4).

## 2. Why not the Next.js replatform

A full design for replatforming to Next.js on Cloudflare Workers was written,
measured, adversarially reviewed, and rejected. The reasoning is recorded here
because it is the most expensive thing this project now avoids, and because a
future reader will otherwise re-propose it.

**The page builder never required it.** Every capability in goal 1 —
`pageBuilder[]`, block types, the insert-menu grid, `page` documents, slug
validation, navigation references — is a **Sanity Studio schema feature**. It
renders through any frontend. The owner can drag-reorder blocks in the Studio's
array editor on the current Astro site with no frontend change at all.

**What Next actually bought was preview ergonomics**: a preview that updates
without a full page reload, and drag-reorder inside the Presentation iframe.
Both are real improvements. Neither is a capability she lacks. Weighed against a
React runtime on a site that ships none, a mandatory paid Workers plan, a
permanent `@opennextjs/cloudflare` dependency, and a Next major release every
October, they did not justify the cost. The owner's judgement was that a reload
on save is acceptable.

**Measurements taken during that investigation**, kept because they are hard-won
and would otherwise be repeated:

| Finding | Measured |
| --- | --- |
| OpenNext bundle | 1.51 MB gzip; not a constraint on either plan |
| CPU per React SSR render | 25–319 ms, median 223 ms — a property of Next/OpenNext, not of this site |
| Workers Free CPU cap | 10 ms per invocation; Next SSR cannot fit, at any bundle size |
| Workers Paid | $5/mo, **account-level**, 10M requests + 30M CPU-ms. Already active on this account |
| Workers Cache | GA since 2026-07-06, all plans. `"cache": {"enabled": true}`. Cache hits do not run the Worker and bill no CPU. Verified: 5 cached requests → 0 invocations |
| Purge by tag | `cache.purge({tags})` from `cloudflare:workers`. Not Enterprise-gated since April 2025. Returns `{success: false}` on rate-limit rather than throwing |
| Next `[slug]` without `generateStaticParams` | Renders dynamic → `private, no-cache, no-store` → never cacheable |
| Overriding cache headers | `headers()` in `next.config.ts` **does** override `Cache-Control` on dynamic routes under Next 16.3.1 + OpenNext 1.20.2 |
| Cookies and the cache key | Cookies are **not** in the Workers Cache key, and lookup precedes Worker execution — so draft-mode cookies do not bypass a warm cache without `Vary: Cookie` |

The Workers Cache findings are stack-independent and inform §7.

## 3. Content model

Framework-independent, and the substance of this project.

### 3.1 Studio language

Schema **field names stay English** — they are code and appear in GROQ.
Everything the owner sees is German: field titles, descriptions, and validation
messages. `@sanity/locale-de-de` translates the Studio chrome.

That package's own README notes its translations were initially machine
-produced, and several surfaces have no German at all. So the bar is **"nothing
she routinely touches is in English"**, not "no English exists anywhere" — the
latter is not achievable and pretending otherwise sets up a false expectation.

### 3.2 Documents

| Type | Change | Why |
| --- | --- | --- |
| `siteSettings` | singleton; gains `headerLinks[]`, `footerLinks[]`, field groups | Grows past a dozen fields; groups keep it navigable |
| `homePage` | keeps its singleton id; fields replaced by `pageBuilder[]`; **gains real delete protection** | The one page that must exist |
| `page` | **new** — `title`, `slug`, `pageBuilder[]`, `seo` | Lets her add `/ueber-uns` without a developer |
| `legalPage` | **deleted**, converted to `page` | See below |

**`legalPage` merges into `page`.** Three complexities existed only because two
types shared one URL namespace: a cross-type slug uniqueness rule, a two-branch
route, and nav links referencing either type. Merging deletes all three, and a
non-developer sees one concept instead of two. The rigidity a separate type
appeared to buy was illusory — the imprint body was already freely editable.
What protects the imprint is the placeholder test in §9, which is
type-independent. The legal pages stay visibly grouped in the Studio through a
structure filter (§5), not a separate type.

**Singletons are currently deletable, despite prior claims otherwise.**
`studio/sanity.config.ts` filters `templates`, which removes *creation* templates
only. There is no `document.actions` override, so the owner can open Startseite →
⋮ → Delete today. Deleting `homePage` or `siteSettings` makes every subsequent
build crash on a null dereference — which, once publishing is automated, means
every publish fails while the live site keeps serving old HTML. The fix is a
`document.actions` filter removing `delete` and `duplicate` for singleton types,
plus null guards that fail with a readable message rather than a TypeError.

**Slugs must handle umlauts.** `slug` validates `^[a-z0-9-]+$`, and Sanity's
default slugify does not transliterate — so `Über uns` becomes `über-uns` and
fails validation on a string that looks lowercase to her, with no path forward.
A custom `slugify` maps ä→ae, ö→oe, ü→ue, ß→ss before lowercasing. Without this
the very first page she creates can dead-end.

**Navigation is explicit**, replacing `LEGAL_PAGE_NAV_QUERY`, which auto-listed
legal pages sorted by title. This is control she gains — and also a way to
publish a page that is reachable by URL but linked from nowhere. A validation
warning fires when a published `page` has no inbound nav link.

### 3.3 Blocks

Five to start. Sanity's documented failure mode for page builders is *too many
block types*; this set grows on demand.

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
as `media`. Consistent previews are what make a collapsed array legible.

`pageBuilder` sets `options.insertMenu.views` to a `grid` with
`previewImageUrl`, so adding a block means picking a thumbnail rather than
choosing from a dropdown of type names.

Three conventions, none optional:

- **Variants are strings, and every one passes through `stegaClean` before it is
  compared or mapped to a class.** Stega characters break string equality, so an
  uncleaned variant silently falls through to the default. `stegaClean` is
  applied to individual compared values, never to Portable Text wholesale — that
  strips the overlay markers.
- **Heading levels are never stored.** Storing `h1`/`h2` in content breaks
  accessibility. The page builder passes a `semanticLevel`: `h1` for the first
  block, `h2` thereafter.
- **`_key` as the render key, never an array index.**

### 3.4 What keeps the catalogue additive

1. **Slug namespace reserved.** Pages live at `/<slug>`; products will live at
   `/produkte/<slug>`. `produkte` is a forbidden page slug from day one —
   retrofitting a URL namespace is a breaking change.
2. **Slug uniqueness** uses a rule written to extend to further types.
3. **Nav links reference a document, not a type-specific field**, so adding
   `product` is one line, and a future `productList` block slots into
   `pageBuilder` without touching any existing block.

## 4. Rendering

Blocks become `.astro` components. The public build adds no new framework and
ships no client JavaScript; the preview build is the one exception, described
below.

```
site/src/
├── components/
│   ├── PageBuilder.astro          # switch on _type, keyed by _key
│   └── blocks/{Hero,RichText,ImageText,Gallery,Cta}.astro
├── pages/
│   ├── index.astro                # homePage singleton
│   ├── [slug].astro               # page (incl. impressum, datenschutz)
│   └── 404.astro
└── lib/{sanity,content,image}.ts
```

`lib/image.ts`, the Tailwind theme, `Prose.astro` and the existing prose
components port unchanged. `astro-portabletext` stays. Block props are typed off
the generated query types, so schema drift is a type error rather than a blank
section.

`[slug].astro` keeps a single, unbranched `getStaticPaths` export across both
build modes. Astro's server output silently skips `getStaticPaths` for
non-prerendered routes rather than erroring on it, so the same file drives
static generation on the public build and per-request rendering on the preview
build.

Because the static build renders server-side at build time with no islands, the
public site continues to ship **no client-side JavaScript** — the original
design's goal, which the Next plan would have retired, survives intact for the
traffic that matters. The preview build is the exception: `@sanity/astro`'s
visual-editing overlay renders as `client:only="react"` (§5), so the preview
Worker alone pulls in `@astrojs/react`, `react`, and `react-dom` — a real
island, but confined to the one deployment nobody but the owner and the
developer ever load.

## 5. Studio

```
Inhalt
├─ Website-Einstellungen     singleton → siteSettings   (groups: Marke, Navigation, 404, SEO)
├─ Startseite                singleton → homePage
├─ ─────────
├─ Seiten                    page, excluding the legal two
└─ Rechtliches               page, filtered to impressum + datenschutz
```

`@sanity/locale-de-de` is added. `autoUpdates: false` stays. The TypeGen
mechanism is unchanged.

**The Presentation tool is adopted**, pointed at the preview deployment (§7.2):

```ts
presentationTool({
  resolve,
  previewUrl: {
    initial: 'https://preview.softmess.de',
    previewMode: {enable: '/api/draft-mode/enable'},
  },
  allowOrigins: ['https://preview.softmess.de'],
})
```

`resolve.locations` maps `homePage` → `/`, `page` → `/{slug}`, and `siteSettings`
→ every page, labelled "Jede Seite", so editing the brand shows her what it
affects.

The click-to-edit overlay is `@sanity/astro@3.5.0`'s `VisualEditing` component,
imported from `@sanity/astro/visual-editing` and rendered `client:only="react"`
— the one place this project's React island (§4) comes from. The iframe reloads
on each change because that component's default `refresh` handler is literally
`window.location.reload()` rather than a React re-render, confirmed from the
package's source. That is the accepted trade from §2, and it should be written
on the tin so nobody later mistakes it for a bug.

## 5.1 Studio ↔ preview origins

Three prerequisites that are invisible until they fail:

- `preview.softmess.de` and the Studio origin must be in the Sanity project's
  **CORS allowlist** — a project-level setting, distinct from the
  `presentationTool` config's own `allowOrigins` array above, though both need
  the same preview origin — or the overlays fail with a console error and no UI
  signal.
- The Studio's `previewUrl.initial` and the preview Worker's own hostname must
  match exactly, including scheme.
- Local development points `previewUrl.initial` at `http://localhost:4321`, so
  the §6 session can run entirely on a laptop before the preview Worker exists.

## 6. The usability checkpoint

**This is the gate the rest of the project waits behind.** It exists because the
question it answers — can a non-developer actually use this? — is the only
assumption here that cannot be recovered from cheaply, and every prior plan
tested it last.

Once §3 and §4 are built, and before any deployment or publishing work: the
owner sits at a local `pnpm dev` and attempts four tasks, unaided and unprompted,
while the developer watches **silently** and takes notes.

1. Add a new page and give it a sensible address.
2. Make that page reachable from the site's navigation.
3. Reorder two blocks on the home page.
4. Replace a photo.

Known traps to watch for specifically, each of which has a prepared fix:

| Trap | Fix if it bites |
| --- | --- |
| Umlaut in a slug fails validation | Custom slugify (§3.2) — build it upfront |
| Page published but linked from nowhere | Orphan-page validation warning (§3.2) |
| Edits autosave as a draft; she never presses Publish | The most common first-time-Sanity failure. May need a Studio affordance |
| Partial German in Studio chrome | §3.1 sets the bar at "nothing she routinely touches" |
| No visible undo | Document history; free-plan retention is limited — confirm what she has |

**Outcomes.** If she succeeds, the remaining work is deployment (§7) and content
(§8), and reload-free preview stays declined. If she struggles on preview
specifically — not on the Studio — that is the evidence that would reopen §2. If
she struggles on the Studio itself, no frontend would have helped, and the fix is
in the schema.

Forty minutes of watching will settle more than the rest of this document can
predict.

## 7. Publishing and deployment

**There is currently no deployment.** Verified against the full git history:
`.github/workflows/` has only ever contained `verify.yml`. No deploy job, no
`repository_dispatch`, no publish webhook has ever been committed. Publishing in
Sanity today does nothing to the live site, and neither does pushing to `main`.
Any claim that this project "replaces" a rebuild pipeline is false; it **builds
the first one**.

Three jobs are needed, all new: `deploy-site` (`astro build` → `wrangler
deploy`), `deploy-preview` (`PREVIEW=1 astro build` → `wrangler deploy`), and
`deploy-studio` (`sanity build` → `wrangler deploy`). Only `deploy-site` runs on
a content publish; the other two change only when code or schema does.

### 7.1 Three Workers

```
  softmess.de          static assets, Astro `output: 'static'`
  www.softmess.de      → Worker NEVER invoked for public traffic
                         free, unlimited, no CPU, no cache to purge or go stale

  preview.softmess.de  Astro SSR on @astrojs/cloudflare
                       → always renders, never cached, serves DRAFTS
                       → used by one person; traffic is negligible

  studio.softmess.de   Sanity Studio, static assets            ← unchanged
```

**The public site is static, and that is the strongest form of the goal.** HTML
is served by Cloudflare's static-asset router, which does not invoke the Worker
at all — strictly better than SSR-plus-cache, which only gets the Worker *mostly*
out of the way and adds a purge webhook, a TTL, a cache key and several silent
failure modes to get there. It also keeps the property the original design chose
deliberately: **if Sanity is down, the public site is unaffected.** Only
publishing and preview stop working.

The cost is latency between Publish and live: a rebuild, roughly 40 s. Because
she will already have seen the exact result in preview before pressing Publish,
that delay is on a change she has *finished* reviewing, not one she is iterating
on. That is what makes it acceptable, and it is why preview earns its Worker.

### 7.2 The preview Worker

One Astro project, two build modes, selected by an environment variable rather
than a second config file:

```js
// astro.config.mjs
const preview = process.env.PREVIEW === '1'
export default defineConfig({
  output: preview ? 'server' : 'static',
  adapter: preview ? cloudflare() : undefined,
})
```

Preview reads drafts, so it holds a Sanity token — safe because it is
server-side, and impossible on the static build, which has no server.

**Preview must not be publicly readable.** `preview.softmess.de` renders
unpublished content; left open, it publishes every draft to anyone who guesses
the hostname. Protection is the standard draft-mode handshake: an
`/api/draft-mode/enable` route calls `@sanity/preview-url-secret`'s
`validatePreviewUrl(client, url)`, which validates a rotating
`sanity.previewUrlSecret` document the Studio creates — not a hand-rolled
shared secret, which would ship inside the public Studio bundle and defeat the
point. On success it sets a signed cookie and redirects. That cookie must be
`SameSite=None; Secure`: the preview renders inside a Studio iframe on a
different origin, and a `Lax` cookie is silently dropped in that context, which
would make the handshake appear to work while every later request quietly falls
back to published content. Without the cookie the preview Worker serves
**published** content only. Cloudflare Access (free for this seat count) is the
belt-and-braces alternative if the handshake proves fiddly.

Because preview lives on its own hostname and is never cached, none of the
Workers Cache complications from §2 apply: no cache key, no `Vary: Cookie`, no
purge, no TTL. Separating by hostname rather than by cache variant is what makes
this simple, and it is the reason this shape is preferable to the one the Next
spec described.

### 7.3 Publishing

Sanity webhook → GitHub `repository_dispatch` → build → `wrangler deploy` of the
static site only. Filtered to the content types that affect the public site, on
published documents only. The Studio and preview Workers are **not** redeployed
by a content publish — neither changes when content does.

## 8. German copy, slugs, and the privacy fix

Content becomes German, the document element becomes `<html lang="de">`, and
slugs become `impressum` and `datenschutz`, with **redirects from `/imprint` and
`/privacy`**.

**The privacy policy is rewritten because it is currently false.**
`seed/seed.ts:209` publishes *"fonts and images are served from this site's own
server."* Fonts are; images are not — they come from `cdn.sanity.io`. The German
replacement states that no cookies are set, no analytics are used, fonts are
self-hosted, and images are delivered by Sanity's CDN, naming Sanity as the
processor.

Staying on Astro keeps this simple: with no `<SanityLive />` and no client
JavaScript, `cdn.sanity.io` remains the **only** third-party origin, and no
visitor's browser opens a connection to Sanity's API. The Next design would have
added a persistent SSE connection to `api.sanity.io` from every visitor, which
would have required disclosing a second processor and adding public CORS origins.

The visual-editing overlay script loads **only on the preview deployment**, never
on the static public build, so it changes nothing about what a visitor's browser
does and nothing about what the policy must disclose.

**Removing `cdn.sanity.io` too** — proxying images through our own origin so
Sanity never sees a visitor IP — would make the policy's original claim literally
true. It is not in this project. On a static build it means fetching and
fingerprinting images at build time, which is tractable, and it is the natural
follow-up once the page builder is in her hands. Recorded as a want, not a plan.

### 8.1 Migration script

In `seed/`, following the existing `SEED_REPLACE` gating, with a **dry-run mode
that prints every mutation without applying it**. A `sanity dataset export` to a
local file is taken first — it costs nothing, works on any plan, and is the only
real undo.

1. `homePage`'s `heading` / `statement` / `body` / `charm` / `actions` → a single
   `hero` block.
2. The two `legalPage` documents → `page` documents holding one `richText` block,
   with German slugs.
3. The nav implied by `LEGAL_PAGE_NAV_QUERY` → explicit `headerLinks` and
   `footerLinks`.

## 9. Testing

The existing mechanism survives intact — this is a direct benefit of not
replatforming. `pnpm verify` stays offline and secretless, building to `dist/`
with `SANITY_FIXTURES=1` and asserting over the HTML with `linkedom`.

| Check | Status |
| --- | --- |
| TypeGen drift, `astro check`, fixture build, vitest | unchanged |
| Every block renders; variants map to classes; `stegaClean` applied | **new** |
| Page builder renders blocks in array order, keyed by `_key` | **new** |
| Umlaut slugs transliterate correctly | **new** |
| No `[`-bracketed placeholder survives into any built page | unchanged |
| No subresource from any origin but self or `cdn.sanity.io` | unchanged |
| No `<script>` tag is emitted **by the static build** | **unchanged — still passes** |
| Preview without the draft cookie serves published content, not drafts | **new**, `verify:live` |
| Preview hostname is absent from every static build artifact | **new** |

Fixtures gain a page-builder document per block type.

The `<script>` assertion now needs a scope: it holds for the **static public
build** and must not be run against the preview build, which legitimately loads
the visual-editing overlay. Scoping it to `dist/` rather than to the project is
what keeps it honest instead of quietly weakened.

The draft-leak test is the one worth having here — it is this design's
equivalent of the stale-cache trap, in that it fails silently and in the
direction of exposing unpublished content.

## 10. Open items

1. **Imprint address.** `[street and number]` and `[postcode and city]` are
   placeholders. A `§ 5 DDG` imprint without an address is not compliant, and the
   placeholder test fails the build while they are present — deliberately.
   **Owner action, blocks launch.**
2. **DPA with Sanity.** Naming a processor in a privacy policy without an
   Auftragsverarbeitungsvertrag on file is the wrong half of the fix.
   **Owner action.**
3. **German copy.** Every string needs a German original. **Owner action.**
4. **Sanity document-history retention** on the current plan, since it is the
   owner's only undo.
5. **`preview.softmess.de` DNS and CORS.** The hostname needs a Worker custom
   domain, and both it and the Studio origin need adding to the Sanity project's
   CORS allowlist. Neither is currently configured.
6. **Preview access control.** Confirm the draft-mode handshake actually gates
   drafts before the hostname is public — this is the one failure in the design
   that leaks content rather than merely breaking.
7. **Astro SSR cold-start on Workers.** Unmeasured. The account is on Workers
   Paid (§2), so the 10 ms free-plan cap does not apply and this is a latency
   question for one user, not a cost or correctness one.

## 11. Decision log

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| Page builder on Astro | Replatform to Next.js on Cloudflare | The page builder is a Studio feature and needs no replatform; Next bought only preview ergonomics, at the cost of a React runtime, a paid plan, and a Next major every October |
| Reload-based preview accepted | Reload-free preview via Next | Weighed explicitly by the owner and declined |
| Usability session before further work | Test it at cutover, as both prior specs did | It is the only assumption here that cannot be recovered from cheaply |
| `legalPage` merged into `page` | Keep two document types | Deletes cross-type slug validation, a two-branch route, and dual nav reference types |
| Custom umlaut slugify | Sanity's default slugify | `Über uns` → `über-uns` fails validation with no path forward |
| Explicit navigation | Auto-listing legal pages by title | She gains control; the orphan-page warning covers the cost |
| Five blocks | A larger starter set | Sanity's documented failure mode is too many block types |
| `/produkte/<slug>` reserved now | Decide when products arrive | Retrofitting a URL namespace is a breaking change |
| Rewrite the privacy copy | Proxy images through our origin | Sanity is the processor either way |
| Static public build | Astro SSR + Workers Cache + purge | Static assets never invoke the Worker at all, where SSR+cache only mostly avoids it — and it avoids a purge webhook, a TTL, a cache key and several silent staleness modes. Also keeps "the site survives a Sanity outage" |
| Rebuild on publish, ~40 s | Instant publish via cache purge | She has already reviewed the change in preview before pressing Publish, so the delay lands on finished work rather than on iteration |
| Preview on its own hostname | Preview via draft cookie on the production Worker | A separate origin sidesteps the cache key entirely — no `Vary: Cookie`, no cookie-vs-cache-lookup bug, which is exactly what broke the Next design |
| Presentation tool adopted | Studio's built-in preview only | Once a preview deployment exists, Presentation is the thing that makes it usable beside the form |
| Zero client-side JavaScript retained | Retire the goal, as the Next plan did | Not replatforming means never paying that price |
