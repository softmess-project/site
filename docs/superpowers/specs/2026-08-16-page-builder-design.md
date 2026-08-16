# Sanity page builder on Astro — design

Date: 2026-08-16
Status: approved pending spec review

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
- The privacy policy must be true.
- A product catalogue must later be additive, not a refactor.

**Non-goals**

- No replatform. See §2.
- No reload-free preview. Preview reloads the page; this was weighed and
  declined (§2).
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
| `homePage` | keeps its singleton id; fields replaced by `pageBuilder[]` | A singleton cannot be accidentally deleted — worth protecting for the one page that must exist |
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

Blocks become `.astro` components. No new framework, no client JavaScript.

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

Because the whole page renders server-side with no islands, the site continues to
ship **no client-side JavaScript** — the original design's goal, which the Next
plan would have retired, survives intact.

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

**The Presentation tool is deferred**, not adopted. Its value here is preview
that reloads — which the Studio's existing preview affordances largely already
give — and wiring it is only worthwhile if §6 shows she wants a live preview
beside the form. Revisit after the session, with evidence.

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

Two jobs are needed: `deploy-site` (`astro build` → `wrangler deploy`) and
`deploy-studio` (`sanity build` → `wrangler deploy`), the latter excluded from
content-publish triggers since the Studio bundle only changes with the schema.

**How publishing reaches the live site** is deliberately deferred until after
§6, because it is independent of whether the page builder works. Two options,
to be decided then:

- **Static rebuild on publish.** Sanity webhook → `repository_dispatch` → build
  → deploy. Roughly 40 s from Publish to live. Keeps the current architecture
  entirely, including the property that the site is unaffected if Sanity is down.
- **Astro SSR on Cloudflare + Workers Cache + purge on publish.** Near-instant.
  Uses the §2 findings: `"cache": {"enabled": true}`, explicit
  `Cache-Control: public, s-maxage=300` and `Cache-Tag: site` on every response,
  purge on the publish webhook. Astro SSR is very unlikely to approach the 10 ms
  free-plan CPU ceiling, since the 223 ms figure was React SSR under OpenNext.
  Costs the "site survives a Sanity outage" property unless `stale-if-error` is
  configured.

If the second is chosen, three things from §2 apply and are easy to get wrong: a
**short TTL** (five minutes, not a year) so every silent-staleness failure
self-heals rather than persisting; **checking `purge()`'s return value**, which
reports rate-limiting via `{success: false}` instead of throwing; and
**normalising query strings out of the cache key**, since they are part of it by
default and `?i=1..100000` would otherwise burn a large share of the monthly CPU
allowance from a single client.

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
| No `<script>` tag is emitted | **unchanged — still passes** |

Fixtures gain a page-builder document per block type.

## 10. Open items

1. **Imprint address.** `[street and number]` and `[postcode and city]` are
   placeholders. A `§ 5 DDG` imprint without an address is not compliant, and the
   placeholder test fails the build while they are present — deliberately.
   **Owner action, blocks launch.**
2. **DPA with Sanity.** Naming a processor in a privacy policy without an
   Auftragsverarbeitungsvertrag on file is the wrong half of the fix.
   **Owner action.**
3. **German copy.** Every string needs a German original. **Owner action.**
4. **Publishing mechanism** — decided after §6 (see §7).
5. **Presentation tool** — decided after §6 (see §5).
6. **Sanity document-history retention** on the current plan, since it is the
   owner's only undo.

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
| Publishing mechanism deferred | Decide it now | Independent of §6's outcome, and §6 may change what is worth building |
| Presentation tool deferred | Adopt it with the page builder | Its value is preview ergonomics — the thing §6 exists to measure |
| Zero client-side JavaScript retained | Retire the goal, as the Next plan did | Not replatforming means never paying that price |
