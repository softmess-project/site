# SEO and social metadata — design

Date: 2026-08-20
Status: approved

Fix what is measurably wrong with the site's search and social metadata today,
add the tags it never emitted, and move the derivation out of `Base.astro` into
one tested module — so that adding a `product` or `post` document type later
means writing a new JSON-LD builder, not editing the `<head>` again.

Scope was chosen deliberately: **harden today, build the seam, scaffold
nothing.** No `post` type, no `product` type, no feed. §8 records what those
will need and why each piece is cheap once this lands.

## 1. Goals and non-goals

**Goals**

- A link to any page renders a correct preview on Facebook, LinkedIn, WhatsApp,
  Signal, Slack and Discord. Today it does not (§2.1).
- The site has a favicon. Today it has none at all (§2.2).
- `<html lang>` tells the truth on every page. Today it says `de` on pages
  written in English (§2.3).
- Google has an `Organization` record tying the brand, its contact address and
  its Instagram profile together.
- The metadata derivation is a pure function with a unit test, not thirty lines
  of `.astro` frontmatter.
- The public site still ships **no executable JavaScript and no third-party
  subresource**. Both remain enforced by `test/dist.test.ts`; one of the two
  assertions is narrowed rather than weakened (§6).

**Non-goals**

- No `<lastmod>` in the sitemap. `src/pages/sitemap.xml.ts` already argues
  against it for a three-route sitemap and search engines discount an
  unverifiable value; that reasoning stands until there is a blog.
- No RSS or Atom feed, no `Article` or `Product` JSON-LD, no `/blog` route.
  Nothing to put in them yet.
- No `hreflang`. The site is mixed-language by design (§4), not translated —
  the German imprint is not an alternate of the English home page, so there are
  no alternate pairs to declare. This refines
  `2026-08-16-page-builder-design.md`, which asserted "the site is German
  throughout"; that was true of the Studio and never true of the rendered copy.
- No `site.webmanifest`, no PWA, no install prompt.
- No generated social cards. Compositing text onto an image needs a rasterizer
  at build time; Sanity's image API cannot do it, and the per-page `ogImage`
  field already covers the case that matters.

## 2. What is wrong today

### 2.1 `og:image` is served as WebP

`Base.astro` builds the social image with `srcFor`, and `srcFor` hardcodes
`.format('webp')` (`site/src/lib/image.ts:33`). WebP is correct for on-page
`<img>`, and wrong here: LinkedIn's and Facebook's scrapers do not reliably
render a WebP `og:image`. The failure is silent — the tag is present, the URL
resolves, and the card renders with no image.

Three tags that would remove the remaining guesswork are also absent:
`og:image:width`, `og:image:height`, `og:image:type`. We request a fixed
1200×630 box, so all three are known for certain rather than inferred.

### 2.2 There is no favicon

`site/public/` contains one file, `_redirects`. No `favicon.ico`, no
`favicon.png`, no `apple-touch-icon`, and no `<link rel="icon">`. Google shows
favicons beside mobile search results; browser tabs show a blank page icon. The
wordmark is live text in Bagel Fat One, so there is no existing asset to point
at — §5 covers where the art comes from.

### 2.3 `<html lang="de">` is hardcoded and wrong

`Base.astro:48`. Every rendered string on the home page is English — "made by
hand", "say hi", "follow the white rabbit" — while the imprint and the privacy
policy are German. One hardcoded value cannot be right for both.

### 2.4 Missing tags

`og:url`, `og:site_name`, `og:locale`. And `robots` is emitted **only** when a
page is excluded, so the site never asks for `max-image-preview:large` — the
directive that decides whether Google may show a large image rather than a
thumbnail. For a brand whose product is entirely visual that is the single
highest-value line in this document.

### 2.5 No structured data

None at all. `Organization` is the one type today's content can populate
honestly.

## 3. Architecture: `site/src/lib/seo.ts`

All derivation moves into one module of pure functions, mirroring `variants.ts`,
`link.ts` and `draft.ts` — logic in `lib/`, a `test/*.test.ts` beside it, and no
Astro rendering needed to test it.

```ts
export type OgType = 'website' | 'article' | 'product'

export interface SeoInput {
  title: string
  seo?: Seo | null
  settings: SiteSettings
  pathname: string
  site: URL
  ogType?: OgType   // defaults to 'website'
  noIndex?: boolean // a route excluding itself, independent of content — the 404
}

export interface SeoMeta {
  title: string
  description: string | null
  canonical: string
  lang: 'en' | 'de'
  ogLocale: 'en_US' | 'de_DE'
  ogType: OgType
  siteName: string
  robots: string
  image: {url: string; alt: string | null; width: number; height: number; type: string} | null
}

export function buildSeo(input: SeoInput): SeoMeta
export function organizationJsonLd(settings: SiteSettings, site: URL): object
```

`Base.astro` calls `buildSeo` once and maps the result to tags. It keeps no
derivation of its own, and it gains three props:

```ts
jsonLd?: object[]
ogType?: OgType
noIndex?: boolean
```

`jsonLd` is an array, not an object, because a future post page emits `Article`
*and* `BreadcrumbList` together. `index.astro` passes
`[organizationJsonLd(settings, Astro.site!)]` — the non-null assertion because
`Astro.site` is typed `URL | undefined` while `astro.config.mjs` sets it
unconditionally for both builds. `404.astro` passes `noIndex`; nothing passes
`ogType` yet.

`ogType` stays a parameter with a `'website'` default even though nothing
overrides it yet. That is the whole seam: a `post` page passes
`ogType: 'article'` and its own JSON-LD, and neither `Base.astro` nor `seo.ts`'s
existing branches change. It costs one optional field to leave open and a
refactor to add later.

`buildSeo` reads `import.meta.env.PREVIEW` directly for the preview-build
`noindex`, as `lib/image.ts` and `lib/draft.ts` already do. `test/middleware.test.ts`
establishes how to toggle it under vitest.

**Robots value.** One tag, two mutually exclusive contents:

| condition | `robots` |
| --- | --- |
| `PREVIEW`, or site-wide `noIndex`, or page `noIndex`, or the `noIndex` input | `noindex` |
| otherwise | `max-image-preview:large` |

`noindex` alone, without `nofollow` — preserving the reasoning already recorded
in `Base.astro`: an excluded page may still link to pages that should be
crawled.

**Stega.** Every value that lands in JSON-LD goes through `stegaClean` (via
`variants.ts`'s `clean`). A source-map payload is invisible in a meta tag and
harmless there, but inside structured data it is a string a validator will read.
Meta tags keep their stega markers, as today. Portable Text is never involved
here, so the standing prohibition does not apply.

## 4. Per-page language

`language` becomes a field on the shared `seo` object type, which means it
inherits the three-level fall-through that already exists: `siteSettings` holds
the site default, `homePage` and each `page` may override.

Values `en` and `de`. `buildSeo` maps them to both `<html lang>` and
`og:locale` (`en` → `en_US`, `de` → `de_DE`).

**The fallback when nothing is set anywhere is `de`.** This is the same trap
`noIndex` documents in `studio/schemaTypes/seo.ts`: `initialValue` applies only
to newly created documents, so every document that already exists reads
`undefined`. A code default of `en` would silently relabel the German imprint
and privacy policy on the next build. `de` preserves exactly what ships today,
and the owner then sets **Englisch** on `homePage` — one deliberate edit, in the
direction where being wrong is visible rather than invisible.

Language is not strictly a "Suchmaschinen" concern, so the field sits slightly
oddly in that Studio group. It goes there anyway: `lang` is a genuine search
signal, and reusing a fall-through that works beats building a second one
beside it.

## 5. The icon, editor-managed and self-hosted

An `icon` image field on `siteSettings` (brand group) — the owner uploads the
art in the Studio, no build tooling, no asset committed to the repo.

Serving it from `cdn.sanity.io` would make **every** page contact Sanity,
including the legal pages and the 404, which today load no images at all. That
is a regression against the same promise that made the fonts self-hosted, and
it is avoidable:

- `src/pages/favicon.png.ts` — 96×96 PNG. Google requires a favicon whose
  dimensions are a multiple of 48px square.
- `src/pages/apple-touch-icon.png.ts` — 180×180 PNG.

Both are prerendered endpoints that **fetch the resized bytes from Sanity at
build time** and return them, exactly as `robots.txt.ts` and `sitemap.xml.ts`
are prerendered endpoints today. They land in `dist/` as ordinary static files,
served same-origin. The build already reaches `api.sanity.io` from CI, so
reaching `cdn.sanity.io` there is no new capability — and the zone's outbound
TLS problem (BACKLOG §1.1) never applies, because no Worker is involved in the
static build.

**Neither route ever answers 404, and that is load-bearing.** A prerendered
endpoint writes its body to `dist/` whatever status it returns, and Cloudflare's
asset router then serves that file with HTTP 200 — the trap already recorded in
`astro.config.mjs`, where `/api/draft-mode/enable` had to be *injected* rather
than status-guarded because the public site answered 200 on a route claiming to
be absent. A 404 branch here would ship a zero-byte `favicon.png` answering 200.

So the three cases all produce valid PNG bytes, and `Base.astro` emits both
`<link>` tags unconditionally — no `hasIcon` gate, and nothing downstream has to
reason about whether the file exists:

- **No icon uploaded** — a 1×1 transparent PNG. A blank favicon, which is
  exactly what the site shows today, replaced by the real thing the moment one
  is uploaded. `Organization.logo` is still omitted in this case: a blank
  placeholder is not a logo.
- **Fixture mode** (`SANITY_FIXTURES=1`) — the same 1×1 PNG, because the
  fixture's asset ref is a synthetic zero ID with nothing behind it. The offline
  build therefore emits both routes and both `<link>` tags resolve, which is the
  same reason the fixtures model every block type.
- **Real build, an icon is set but the fetch fails** — throw, with a German
  message, matching `getSiteSettings`. A broken upload must not pass the deploy
  gate quietly.

`image.ts` gains one lower-level helper for both this and §7:

```ts
function cdnSrcFor(source, width, height, format): string   // never proxied
```

`_redirects` gains `/favicon.ico /favicon.png 301`. Browsers that honour
`<link rel="icon">` never request `/favicon.ico`, but crawlers and preview tools
do, and without the rule Cloudflare's `not_found_handling: "404-page"` answers
them with the 404 HTML page.

## 6. Structured data and the no-JavaScript invariant

`test/dist.test.ts:195` currently asserts **zero** `<script>` elements. JSON-LD
is a `<script type="application/ld+json">` tag: not executable, but it breaks
that assertion literally.

The assertion is narrowed to state what it actually means — *no executable
script* — as two conditions that must both hold on every built page:

1. No `script` element has a `src` attribute.
2. Every `script` element has `type="application/ld+json"` exactly.

Together those are strictly stronger than "no `src`" and admit nothing that
runs. The no-third-party-subresource test is untouched; it already collects
`script[src]` and finds none.

A new assertion parses each JSON-LD block and checks it is valid JSON carrying
the expected `@type`, so a malformed builder fails the build rather than
shipping invisible garbage.

`organizationJsonLd` emits, on the home page only:

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "<brand>",
  "url": "https://softmess.de",
  "email": "<email>",
  "sameAs": ["<instagram>"],
  "logo": "https://softmess.de/apple-touch-icon.png"
}
```

`logo` points at our own 180×180 route rather than a `cdn.sanity.io` URL: it
clears Google's 112×112 minimum, and it keeps a third-party host out of the
structured data. `logo` and `email` are omitted when absent rather than emitted
empty.

Known simplification: one square `icon` field serves as both favicon and
`Organization.logo`. A knowledge panel would rather have the wordmark. If that
ever matters, add a second field then — not now.

## 7. Schema changes

`studio/schemaTypes/seo.ts`:

- `language` — `string`, `options.list` of Englisch/Deutsch, `initialValue: 'en'`
  (new documents; the code fallback in §4 covers the rest), German title and
  description.
- `title` gains `validation: (rule) => rule.max(60).warning(...)`, matching the
  `max(160)` warning the description already carries.

`studio/schemaTypes/siteSettings.ts`:

- `icon` — `image`, brand group, German label and a description stating that it
  should be square and at least 512×512.

## 8. Query and type changes

- `SEO_PROJECTION` in `content.ts` gains `language`.
- `SITE_SETTINGS_QUERY` gains `icon{asset}` — no `alt`, an icon is decorative
  chrome and never rendered as content.
- `pnpm typegen` regenerates `site/src/sanity.types.ts`. `Seo` and `SiteSettings`
  are already derived from the query result types, so both new fields reach the
  components as type errors if a projection is forgotten.
- Fixtures gain the new fields: `icon` and `seo.language` on `siteSettings.json`,
  `seo.language` on `homePage.json` and on both entries in `pages.json` — `en`
  for the home page, `de` for the two legal pages, so the offline build covers
  both branches of the locale map.

`SITEMAP_QUERY` is untouched.

## 9. Testing

**`site/test/seo.test.ts`** (new) — `buildSeo` as a pure function:

- title, description and `ogImage` fall through page → site default → absent,
  for each field independently.
- `language` falls through the same three levels; absent everywhere yields `de`.
- locale map: `en` → `en_US`, `de` → `de_DE`.
- `robots` is `noindex` for each of the four conditions in §3 and
  `max-image-preview:large` otherwise.
- canonical has no trailing slash and is absolute against `site`.
- `organizationJsonLd` omits `logo` and `email` when absent, and its output is
  free of stega markers.

**`site/test/dist.test.ts`** (extended) — against built HTML:

- the narrowed script rule (§6) plus JSON-LD parse-and-`@type`.
- `og:url`, `og:site_name`, `og:locale`, `og:image:width/height/type` present on
  every page.
- `og:image` URL contains `fm=jpg` and does **not** contain `fm=webp`, in both
  the proxied and unproxied shapes.
- `html[lang]` is `en` on `index.html` and `de` on the two legal pages
  (fixture-only — real content's language is the owner's to set).
- `favicon.png` and `apple-touch-icon.png` exist in `dist` and begin with the
  PNG magic bytes.
- `robots` is `max-image-preview:large` on indexed pages, `noindex` on `404.html`.

**Gate:** `pnpm verify`. Then `pnpm build:site:deploy` for the real-content run,
which is where a missing icon upload surfaces.

## 10. Files touched

New: `site/src/lib/seo.ts`, `site/src/pages/favicon.png.ts`,
`site/src/pages/apple-touch-icon.png.ts`, `site/test/seo.test.ts`.

Modified: `site/src/layouts/Base.astro`, `site/src/lib/image.ts`,
`site/src/lib/content.ts`, `site/src/pages/index.astro`,
`site/src/pages/404.astro`, `site/public/_redirects`,
`site/src/sanity.types.ts` (generated), `site/test/dist.test.ts`,
`site/test/fixtures/{siteSettings,homePage,pages}.json`,
`studio/schemaTypes/seo.ts`, `studio/schemaTypes/siteSettings.ts`,
`docs/BACKLOG.md`.

## 11. What the catalog and the blog will still need

Recorded so the next pass does not rediscover it, and so nothing here is built
speculatively now.

**Blog.** A `post` document type; a `/blog` index route; `ogType: 'article'`
plus `article:published_time` and `article:modified_time`; `BlogPosting` JSON-LD
with `datePublished`, `dateModified` and `author`; an RSS or Atom endpoint
(another prerendered route, same shape as `sitemap.xml.ts`); and `<lastmod>` in
the sitemap, which becomes worth its cost once `_updatedAt` is meaningful —
`SITEMAP_QUERY` would project it and `PAGE_ROUTE_FILTER` would widen to cover
the second document type. Per-page descriptions stop being optional at that
point: the site-wide fall-through is fine across three pages and becomes a
duplicate-description problem across thirty.

**Catalog.** `Product` JSON-LD earns nothing without real offer data, so the
blocking question is commercial, not technical: is there a price, is there
stock, does a visitor buy on-site or by Instagram DM. `Offer` with
`availability` and `priceCurrency` follows from that answer. An image sitemap
extension becomes worthwhile at the same time. This needs its own brainstorm.

**Both** plug into §3 unchanged: a new `OgType`, a new JSON-LD builder beside
`organizationJsonLd`, and a `jsonLd` array from the new page. `Base.astro`'s
head does not move again.
