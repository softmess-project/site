# SEO and social metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the WebP `og:image`, the hardcoded `lang="de"` and the missing favicon; add the Open Graph and robots tags the site never emitted plus `Organization` JSON-LD; and move all of it into one tested module so a future `post` or `product` type plugs in without touching `Base.astro` again.

**Architecture:** A new pure module `site/src/lib/seo.ts` derives every head value from `{title, seo, settings, pathname, site, ogType, noIndex}` and returns a plain `SeoMeta` object; `Base.astro` does nothing but map that object to tags. Two prerendered endpoints fetch the editor-uploaded icon from Sanity **at build time** and emit it into `dist/`, so visitors fetch the favicon same-origin. Structured data ships as `<script type="application/ld+json">`, which requires narrowing one assertion in `test/dist.test.ts` from "no script tags" to "no *executable* script tags".

**Tech Stack:** Astro 7 (static + SSR preview builds from one project), Sanity (GROQ + TypeGen), Tailwind v4, vitest, linkedom for built-HTML assertions, Cloudflare Workers static assets.

**Spec:** `docs/superpowers/specs/2026-08-20-seo-social-design.md`

## Global Constraints

- **Prettier:** no semicolons, single quotes, no bracket spacing, 100 columns.
- **All editor-facing strings are German** — schema titles, descriptions, validation messages, build-failure messages. Code and comments are English.
- **Comments explain *why*,** usually recording a failure actually observed. Do not delete existing ones while editing nearby code.
- **Never run `pnpm verify` while `pnpm dev` is running** — the Studio's typegen watcher rewrites `site/src/sanity.types.ts` underneath it and the drift check fails spuriously.
- `site/src/sanity.types.ts` is **committed**. Any schema or projection change requires `pnpm typegen` in the same commit, or `pnpm verify` fails on the diff.
- Every GROQ query is a `defineQuery` const in `site/src/lib/content.ts` — never in `.astro` frontmatter.
- The public site ships **no executable JavaScript and no third-party subresource**. Both stay enforced by `site/test/dist.test.ts`.
- **Never `stegaClean` Portable Text.** Plain strings are fine (`site/src/lib/variants.ts` exports `clean` for exactly that).
- The gate is `pnpm verify`. Site tests need the fixture build first; `pnpm --filter site test` does both.
- Commit messages follow the repo's conventional-commit style (`feat(seo):`, `fix(site):`, `docs:`) and end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

**Branch:** `feat/seo-social-metadata`, cut from `main` **after** PRs #5 and #6 have merged. `main` before that merge has no `robots.txt.ts`, no `sitemap.xml.ts` and no `noIndex` field on `seo`; every task below assumes all three exist.

---

### Task 1: Schema fields, projections, types, fixtures

Pure plumbing: two new content fields reach the frontend as types, and the fixtures carry values that exercise every branch later tasks assert on. No rendering changes yet, so `pnpm verify` must pass at the end with the site looking exactly as it does today.

**Files:**
- Modify: `studio/schemaTypes/seo.ts`
- Modify: `studio/schemaTypes/siteSettings.ts`
- Modify: `site/src/lib/content.ts:37` (`SEO_PROJECTION`) and the `SITE_SETTINGS_QUERY` projection
- Modify: `site/src/sanity.types.ts` (generated — never hand-edited)
- Modify: `site/test/fixtures/siteSettings.json`, `site/test/fixtures/homePage.json`, `site/test/fixtures/pages.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `Seo['language']` and `SiteSettings['icon']` on the exported types in `site/src/lib/content.ts`. Tasks 3, 4 and 5 read them. Note TypeGen may emit `language` as either `'en' | 'de' | null` (narrowed from `options.list`) or `string | null` depending on version — Task 3's code guards for both, so either is fine.

- [ ] **Step 1: Add the `language` field to the shared `seo` object type**

In `studio/schemaTypes/seo.ts`, insert after the `description` field and before `noIndex`:

```ts
    defineField({
      name: 'language',
      title: 'Sprache',
      type: 'string',
      description:
        'Die Sprache dieser Seite. Bestimmt das lang-Attribut im HTML und die ' +
        'Sprachangabe beim Teilen eines Links.',
      options: {
        list: [
          {title: 'Englisch', value: 'en'},
          {title: 'Deutsch', value: 'de'},
        ],
        layout: 'radio',
      },
      // Same trap as `noIndex` below: `initialValue` applies only to newly
      // created documents, so every document that already exists reads
      // `undefined`. The code fallback in site/src/lib/seo.ts is therefore
      // 'de' — what the site renders today — and the site-wide default is set
      // on siteSettings rather than assumed here. A code default of 'en' would
      // silently relabel the German imprint on the next build.
      initialValue: 'en',
    }),
```

- [ ] **Step 2: Add the title-length warning**

In the same file, the `title` field currently has no validation. Add it, matching the `max(160)` warning the description already carries:

```ts
    defineField({
      name: 'title',
      title: 'Titel',
      type: 'string',
      description: 'Überschreibt den Titel im Browser-Tab und in Suchergebnissen',
      validation: (rule) => rule.max(60).warning('Möglichst unter 60 Zeichen halten'),
    }),
```

- [ ] **Step 3: Add the `icon` field to `siteSettings`**

In `studio/schemaTypes/siteSettings.ts`, insert into the `brand` group after the `copyright` field:

```ts
    defineField({
      name: 'icon',
      title: 'Website-Icon',
      type: 'image',
      group: 'brand',
      description:
        'Das kleine Symbol im Browser-Tab und neben dem Suchergebnis. Quadratisch ' +
        'und mindestens 512×512 Pixel.',
    }),
```

No `alt` field and no `options.hotspot`: an icon is decorative chrome, never rendered as content, and is always cropped square.

- [ ] **Step 4: Extend the projections**

In `site/src/lib/content.ts`, change `SEO_PROJECTION` (line 37):

```ts
const SEO_PROJECTION = `seo{title, description, language, noIndex, ogImage{alt, asset}}`
```

And add `icon` to `SITE_SETTINGS_QUERY`'s projection — on the line carrying `brand, tagline, …`:

```ts
    brand, tagline, email, instagram, instagramHandle, copyright, icon{asset},
```

- [ ] **Step 5: Regenerate the committed types**

Run: `pnpm typegen`
Expected: `site/src/sanity.types.ts` changes; `git diff --stat site/src/sanity.types.ts` shows additions for `language` and `icon`.

- [ ] **Step 6: Give the fixtures values that cover every language branch**

Three different resolution paths, so Task 4's assertions prove the fall-through rather than one hardcoded value.

In `site/test/fixtures/siteSettings.json`, leave the site-wide language unset (this is the path that must land on the `'de'` code default) and add the icon. Inside the existing `"seo"` object add `"language": null` after `"description"`, and at the top level add a sibling to `"copyright"`:

```json
  "icon": {
    "asset": {
      "_ref": "image-0000000000000000000000000000000000000000-512x512-png",
      "_type": "reference"
    }
  },
```

The synthetic zero-ID ref matches the convention already used for `seo.ogImage` in this file — it is never fetched, because Task 5's endpoint short-circuits in fixture mode.

In `site/test/fixtures/homePage.json`, inside `"seo"`, add `"language": "en"`.

In `site/test/fixtures/pages.json`, inside the `impressum` entry's `"seo"`, add `"language": "de"`; inside the `datenschutz` entry's `"seo"`, add `"language": null`.

That gives: explicit `en` (home), explicit `de` (impressum), and full fall-through to the code default (datenschutz, whose site-wide value is also unset).

- [ ] **Step 7: Verify nothing regressed**

Run: `pnpm --filter site test`
Expected: PASS. The new fields are projected and typed but nothing reads them yet, so every existing assertion still holds.

- [ ] **Step 8: Commit**

```bash
git add studio/schemaTypes/seo.ts studio/schemaTypes/siteSettings.ts \
        site/src/lib/content.ts site/src/sanity.types.ts site/test/fixtures
git commit -m "$(cat <<'EOF'
feat(seo): add a per-page language and a site icon to the content model

Neither is read yet. `language` goes on the shared `seo` object so it
inherits the siteSettings -> document fall-through that already exists,
and `icon` feeds both the favicon routes and Organization JSON-LD.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: JPEG social images

Fixes the defect from spec §2.1 in isolation, so the diff that changes what scrapers receive is reviewable on its own.

**Files:**
- Modify: `site/src/lib/image.ts`
- Test: `site/test/content.test.ts` (extend — it already tests `srcFor`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `cdnSrcFor(source: SanityImageSource, width: number, height: number, format: 'jpg' | 'png' | 'webp'): string` — an absolute `cdn.sanity.io` URL, never proxied. Task 5 uses it.
  - `socialSrcFor(source: SanityImageSource): string` — the 1200×630 JPEG. Task 3 uses it.
  - `SOCIAL_IMAGE: {readonly width: 1200; readonly height: 630; readonly type: 'image/jpeg'}`. Task 3 uses it.
  - `srcFor` and `srcSetFor` keep their existing signatures and behaviour exactly.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('content layer in fixture mode', …)` block in `site/test/content.test.ts`:

```ts
  it('builds social images as JPEG, never proxied and never WebP', () => {
    // WebP is right for an on-page <img> and wrong for og:image: LinkedIn's
    // and Facebook's scrapers do not reliably render a WebP card, and the
    // failure is silent — the tag is present, the URL resolves, and the card
    // shows no image.
    const url = socialSrcFor({
      _type: 'image',
      asset: {
        _type: 'reference',
        _ref: 'image-0000000000000000000000000000000000000000-966x1207-jpg',
      },
    })
    expect(url).toContain('fm=jpg')
    expect(url).not.toContain('fm=webp')
    expect(url).toContain('w=1200')
    expect(url).toContain('h=630')
    // Absolute even under PROXY_IMAGES=1, which `pnpm test` sets: a scraper is
    // not a visitor, so routing it through /cdn/* buys no privacy — and that
    // route 525s on the zone (docs/BACKLOG.md §1.1), which would make every
    // card imageless.
    expect(url.startsWith('https://cdn.sanity.io/')).toBe(true)
  })

  it('keeps on-page images WebP and still honours the proxy flag', () => {
    const url = srcFor(
      {
        _type: 'image',
        asset: {
          _type: 'reference',
          _ref: 'image-0000000000000000000000000000000000000000-966x1207-jpg',
        },
      },
      380,
      480,
    )
    expect(url).toContain('fm=webp')
    expect(url.startsWith(PROXIED ? '/cdn/' : 'https://cdn.sanity.io/')).toBe(true)
  })
```

Add `socialSrcFor` to the existing `import {srcFor} from '../src/lib/image'` line, and add this near the top of the file, below the imports:

```ts
// Must match the flag the fixture build ran with — `pnpm test` sets
// PROXY_IMAGES=1, and vitest.config.ts forwards it into the test env.
const PROXIED = process.env.PROXY_IMAGES === '1'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter site exec vitest run test/content.test.ts -t 'social images'`
Expected: FAIL — `socialSrcFor is not a function` (or a TypeScript/import error naming `socialSrcFor`).

- [ ] **Step 3: Implement**

In `site/src/lib/image.ts`, keep `sameOrigin` untouched and replace the two exported helpers' bodies. `srcFor` now delegates rather than restating the builder chain:

```ts
/** The og:image box, and the facts about it that Open Graph wants declared.
 *  Exported so lib/seo.ts emits width/height/type from the same numbers the
 *  URL is built with, rather than restating them. */
export const SOCIAL_IMAGE = {width: 1200, height: 630, type: 'image/jpeg'} as const

/** An absolute cdn.sanity.io URL, deliberately never rewritten onto our own
 *  origin. For consumers that are not a visitor's browser: social scrapers and
 *  the build-time favicon fetch. Proxying those buys no privacy — the request
 *  does not come from a visitor — while /cdn/* is exactly the route that gets
 *  HTTP 525 on this zone (docs/BACKLOG.md §1.1), so a proxied og:image would
 *  make every share card imageless. */
export function cdnSrcFor(
  source: SanityImageSource,
  width: number,
  height: number,
  format: 'jpg' | 'png' | 'webp',
): string {
  return builder.image(source).width(width).height(height).format(format).quality(80).url()
}

/** One image URL at a fixed CSS box. Passing both dimensions is what makes
 *  Sanity apply the asset's hotspot/crop instead of a naive centre crop. */
export function srcFor(source: SanityImageSource, width: number, height: number): string {
  return sameOrigin(cdnSrcFor(source, width, height, 'webp'))
}

/** The share-card image. JPEG on purpose: LinkedIn's and Facebook's scrapers
 *  do not reliably render a WebP og:image, and the failure is silent — the tag
 *  is there, the URL resolves, and the card renders with no image at all. */
export function socialSrcFor(source: SanityImageSource): string {
  return cdnSrcFor(source, SOCIAL_IMAGE.width, SOCIAL_IMAGE.height, 'jpg')
}
```

`srcSetFor` is unchanged — it already calls `srcFor`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter site exec vitest run test/content.test.ts`
Expected: PASS, including the pre-existing `builds a proxied image url from an image ref` test — `srcFor`'s output must be byte-identical to before.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/image.ts site/test/content.test.ts
git commit -m "$(cat <<'EOF'
fix(site): serve og:image as JPEG from Sanity's own origin

Base.astro built the social image with srcFor, which hardcodes WebP.
LinkedIn's and Facebook's scrapers do not reliably render a WebP card
and fail silently. cdnSrcFor also skips the /cdn proxy on purpose: a
scraper is not a visitor, and that route 525s on this zone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `lib/seo.ts`, the derivation module

The seam. Everything `Base.astro` computes moves here as pure functions with a unit test, matching how `variants.ts`, `link.ts` and `draft.ts` are structured and tested. Nothing renders it yet.

**Files:**
- Create: `site/src/lib/seo.ts`
- Create: `site/test/seo.test.ts`

**Interfaces:**
- Consumes: `Seo`, `SiteSettings` from `../lib/content` (Task 1); `socialSrcFor`, `SOCIAL_IMAGE` from `../lib/image` (Task 2); `clean` from `../lib/variants`.
- Produces, all used by Task 4 and Task 6:
  - `type OgType = 'website' | 'article' | 'product'`
  - `interface SeoInput {title: string; seo?: Seo | null; settings: SiteSettings; pathname: string; site: URL; ogType?: OgType; noIndex?: boolean}`
  - `interface SeoMeta {title: string; description: string | null; canonical: string; lang: 'en' | 'de'; ogLocale: string; ogType: OgType; siteName: string; robots: string; image: {url: string; alt: string | null; width: number; height: number; type: string} | null}`
  - `buildSeo(input: SeoInput): SeoMeta`
  - `organizationJsonLd(settings: SiteSettings, site: URL): object`
  - `jsonLdScript(entry: object): string`

- [ ] **Step 1: Write the failing test**

Create `site/test/seo.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {buildSeo, jsonLdScript, organizationJsonLd} from '../src/lib/seo'
import type {Seo, SiteSettings} from '../src/lib/content'

const SITE = new URL('https://softmess.de')

const IMAGE_REF = {
  _type: 'reference' as const,
  _ref: 'image-0000000000000000000000000000000000000000-966x1207-jpg',
}

// Only the fields buildSeo reads. Cast rather than fabricate a whole
// SiteSettings: the shape is a generated query-result type and pinning all of
// it here would turn every future projection change into a test edit.
function settings(seo: Partial<Seo> | null = null, extra: Record<string, unknown> = {}) {
  return {brand: 'softmess', seo, ...extra} as unknown as SiteSettings
}

function build(overrides: Partial<Parameters<typeof buildSeo>[0]> = {}) {
  return buildSeo({
    title: 'softmess project',
    settings: settings(),
    pathname: '/',
    site: SITE,
    ...overrides,
  })
}

describe('title and description', () => {
  it('passes the title through untouched', () => {
    // The per-page fallback sentence stays with the caller — it differs per
    // page ("brand tagline" vs "title · brand") and Base.astro never knew it.
    expect(build({title: 'Impressum · softmess'}).title).toBe('Impressum · softmess')
  })

  it('prefers the page description, then the site default, then null', () => {
    expect(build({seo: {description: 'page'} as Seo}).description).toBe('page')
    expect(build({settings: settings({description: 'site'})}).description).toBe('site')
    expect(build().description).toBeNull()
  })
})

describe('language', () => {
  it('prefers the page language, then the site default', () => {
    expect(build({seo: {language: 'en'} as Seo}).lang).toBe('en')
    expect(build({settings: settings({language: 'en'})}).lang).toBe('en')
  })

  it('falls back to de when nothing is set anywhere', () => {
    // Not 'en'. `initialValue` never touched documents that already existed,
    // so absent must mean what the site renders today, or the German imprint
    // gets silently relabelled on the next build.
    expect(build().lang).toBe('de')
  })

  it('ignores a value that is not a known language', () => {
    expect(build({seo: {language: 'fr'} as unknown as Seo}).lang).toBe('de')
  })

  it('maps the language to an Open Graph locale', () => {
    expect(build({seo: {language: 'en'} as Seo}).ogLocale).toBe('en_US')
    expect(build({seo: {language: 'de'} as Seo}).ogLocale).toBe('de_DE')
  })
})

describe('robots', () => {
  it('asks for a large image preview when the page is indexed', () => {
    // The directive that decides whether Google may show a full image rather
    // than a thumbnail — the whole point, for a brand whose product is visual.
    expect(build().robots).toBe('max-image-preview:large')
  })

  it('excludes the page for any of the three content switches', () => {
    expect(build({seo: {noIndex: true} as Seo}).robots).toBe('noindex')
    expect(build({settings: settings({noIndex: true})}).robots).toBe('noindex')
    expect(build({noIndex: true}).robots).toBe('noindex')
  })

  it('never adds nofollow', () => {
    // An excluded page may still link to pages that should be crawled.
    expect(build({noIndex: true}).robots).not.toContain('nofollow')
  })
})

describe('canonical', () => {
  it('is absolute against the build target and keeps no trailing slash', () => {
    expect(build({pathname: '/impressum'}).canonical).toBe('https://softmess.de/impressum')
    expect(build({pathname: '/'}).canonical).toBe('https://softmess.de/')
  })
})

describe('social image', () => {
  it('prefers the page image, then the site default, then null', () => {
    const page = {ogImage: {asset: IMAGE_REF, alt: 'page alt'}} as unknown as Seo
    expect(build({seo: page}).image?.alt).toBe('page alt')
    expect(
      build({settings: settings({ogImage: {asset: IMAGE_REF, alt: 'site alt'}} as Partial<Seo>)})
        .image?.alt,
    ).toBe('site alt')
    expect(build().image).toBeNull()
  })

  it('declares the box it actually requested, as JPEG', () => {
    const image = build({seo: {ogImage: {asset: IMAGE_REF}} as unknown as Seo}).image
    expect(image?.width).toBe(1200)
    expect(image?.height).toBe(630)
    expect(image?.type).toBe('image/jpeg')
    expect(image?.url).toContain('fm=jpg')
    expect(image?.alt).toBeNull()
  })
})

describe('ogType', () => {
  it('defaults to website and passes an override through', () => {
    expect(build().ogType).toBe('website')
    expect(build({ogType: 'article'}).ogType).toBe('article')
  })
})

describe('organization JSON-LD', () => {
  it('emits the brand, its contact address and its Instagram profile', () => {
    const json = organizationJsonLd(
      settings(null, {email: 'hi@softmess.de', instagram: 'https://instagram.com/softmess'}),
      SITE,
    ) as Record<string, unknown>
    expect(json['@type']).toBe('Organization')
    expect(json.name).toBe('softmess')
    expect(json.url).toBe('https://softmess.de/')
    expect(json.email).toBe('hi@softmess.de')
    expect(json.sameAs).toEqual(['https://instagram.com/softmess'])
  })

  it('points logo at our own icon route, and omits it when no icon is set', () => {
    // Our own origin, not cdn.sanity.io: 180×180 clears Google's 112×112
    // minimum and keeps a third-party host out of the structured data.
    const withIcon = organizationJsonLd(
      settings(null, {icon: {asset: IMAGE_REF}}),
      SITE,
    ) as Record<string, unknown>
    expect(withIcon.logo).toBe('https://softmess.de/apple-touch-icon.png')
    expect(organizationJsonLd(settings(), SITE)).not.toHaveProperty('logo')
  })

  it('omits email and sameAs rather than emitting them empty', () => {
    const json = organizationJsonLd(settings(), SITE)
    expect(json).not.toHaveProperty('email')
    expect(json).not.toHaveProperty('sameAs')
  })
})

describe('jsonLdScript', () => {
  it('escapes < so a string can never close the script element', () => {
    const html = jsonLdScript({name: '</script><img onerror=x>'})
    expect(html).not.toContain('</script>')
    expect(html).toContain('\\u003c')
    // Still valid JSON — < is an escape, not a mangling.
    expect(JSON.parse(html)).toEqual({name: '</script><img onerror=x>'})
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter site exec vitest run test/seo.test.ts`
Expected: FAIL — cannot resolve `../src/lib/seo`.

- [ ] **Step 3: Implement**

Create `site/src/lib/seo.ts`:

```ts
import type {Seo, SiteSettings} from './content'
import {SOCIAL_IMAGE, socialSrcFor} from './image'
import {clean} from './variants'

/** Open Graph's object type. Only 'website' is ever passed today; the union is
 *  the seam a `post` or `product` page uses without touching Base.astro or the
 *  branches below. */
export type OgType = 'website' | 'article' | 'product'

export interface SeoInput {
  /** Already resolved by the caller. The fallback sentence differs per page —
   *  "brand tagline" on the home page, "title · brand" on a content page — so
   *  it stays where that knowledge is, exactly as before this module existed. */
  title: string
  seo?: Seo | null
  settings: SiteSettings
  pathname: string
  site: URL
  ogType?: OgType
  /** A route excluding *itself*, independent of content — the 404. Separate
   *  from the two `seo.noIndex` switches, which an editor controls. */
  noIndex?: boolean
}

export interface SeoMeta {
  title: string
  description: string | null
  canonical: string
  lang: Language
  ogLocale: string
  ogType: OgType
  siteName: string
  robots: string
  image: {url: string; alt: string | null; width: number; height: number; type: string} | null
}

type Language = 'en' | 'de'

// The Open Graph spelling of each language we serve. Doubles as the set of
// values `language` is allowed to hold: TypeGen may or may not narrow the field
// to a union depending on its version, and a document written before the field
// existed holds nothing at all, so the value is validated here either way.
const LOCALES: Record<Language, string> = {en: 'en_US', de: 'de_DE'}

const FALLBACK_LANGUAGE: Language = 'de'

function resolveLanguage(page: Seo | null | undefined, settings: SiteSettings): Language {
  const value = clean(page?.language ?? settings.seo?.language ?? undefined)
  return value && value in LOCALES ? (value as Language) : FALLBACK_LANGUAGE
}

export function buildSeo(input: SeoInput): SeoMeta {
  const {title, seo, settings, pathname, site, ogType = 'website'} = input

  const lang = resolveLanguage(seo, settings)

  // Three independent reasons to keep a page out of search results, plus the
  // route's own: the preview Worker (editor-only, and its robots.txt already
  // says Disallow), the site-wide switch on siteSettings, and the page's own.
  // Booleans carry no stega payload, so these need no clean().
  const noIndex =
    import.meta.env.PREVIEW || !!input.noIndex || !!settings.seo?.noIndex || !!seo?.noIndex

  // `noindex` alone, without `nofollow` — an excluded page may still link to
  // pages that should be crawled. When the page *is* indexed the tag is not
  // wasted: max-image-preview:large is what lets Google show a full image
  // instead of a thumbnail, which for this brand is the whole point.
  const robots = noIndex ? 'noindex' : 'max-image-preview:large'

  const source = seo?.ogImage?.asset ? seo.ogImage : settings.seo?.ogImage

  return {
    title,
    description: seo?.description ?? settings.seo?.description ?? null,
    canonical: new URL(pathname, site).href,
    lang,
    ogLocale: LOCALES[lang],
    ogType,
    siteName: settings.brand,
    robots,
    // socialSrcFor is absolute by construction and never proxied, so unlike
    // the on-page helpers this needs no resolving against `site`.
    image: source?.asset
      ? {url: socialSrcFor(source), alt: source.alt ?? null, ...SOCIAL_IMAGE}
      : null,
  }
}

/** The brand as one machine-readable record: what it is called, where it
 *  lives, how to reach it, and which social profile is the same entity. Emitted
 *  on the home page only — that is where a knowledge-panel signal belongs.
 *
 *  Every value is stegaClean'd. A source-map payload is invisible in a meta
 *  tag and harmless there, but inside structured data it is a string a
 *  validator reads. Nothing here is Portable Text, so cleaning is safe. */
export function organizationJsonLd(settings: SiteSettings, site: URL): object {
  const email = clean(settings.email ?? undefined)
  const instagram = clean(settings.instagram ?? undefined)
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: clean(settings.brand ?? undefined) ?? '',
    url: site.href,
    ...(email ? {email} : {}),
    ...(instagram ? {sameAs: [instagram]} : {}),
    // Our own route, not a cdn.sanity.io URL: 180×180 clears Google's 112×112
    // minimum for a logo and keeps a third-party host out of the structured
    // data. Omitted entirely when no icon is uploaded — an empty string here
    // is worse than silence.
    ...(settings.icon?.asset ? {logo: new URL('/apple-touch-icon.png', site).href} : {}),
  }
}

/** Serialize one JSON-LD entry for `set:html`. `<` is escaped because a
 *  content string containing `</script>` would otherwise close the element and
 *  turn editor text into markup. `<` is a JSON escape, so the result still
 *  parses as the same value. */
export function jsonLdScript(entry: object): string {
  return JSON.stringify(entry).replace(/</g, '\\u003c')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter site exec vitest run test/seo.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter site exec astro check`
Expected: no errors. If `settings.brand` is typed `string | null`, `siteName: settings.brand` fails — change it to `settings.brand ?? ''` and note it in the commit body.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/seo.ts site/test/seo.test.ts
git commit -m "$(cat <<'EOF'
feat(seo): derive head metadata in one tested module

Pure functions in lib/, tested without rendering, matching how
variants.ts and link.ts are structured. Nothing renders this yet.

The language fallback is 'de', not 'en': initialValue never touched
documents that already existed, so absent has to mean what the site
renders today or the German imprint gets relabelled silently.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Rewire `Base.astro` and the page callers

Where the new tags actually reach the HTML. `Base.astro` keeps no derivation of its own.

**Files:**
- Modify: `site/src/layouts/Base.astro`
- Modify: `site/src/pages/404.astro`
- Modify: `site/test/dist.test.ts`

**Interfaces:**
- Consumes: `buildSeo`, `OgType` from `../lib/seo` (Task 3).
- Produces: `Base.astro` accepts three new optional props — `ogType?: OgType`, `noIndex?: boolean`, `jsonLd?: object[]`. Task 6 passes `jsonLd`. `index.astro` and `[slug].astro` keep passing exactly what they pass today.

- [ ] **Step 1: Write the failing assertions**

In `site/test/dist.test.ts`, add to the `describe('built pages', …)` block:

```ts
  it('emits the Open Graph tags every scraper reads', () => {
    for (const page of ['index.html', 'impressum/index.html', 'datenschutz/index.html']) {
      const d = doc(page)
      const prop = (name: string) =>
        d.querySelector(`meta[property="${name}"]`)?.getAttribute('content')
      expect(prop('og:url'), page).toBe(
        d.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      )
      expect(prop('og:site_name'), page).toBeTruthy()
      expect(prop('og:locale'), page).toMatch(/^(en_US|de_DE)$/)
      expect(prop('og:type'), page).toBe('website')
    }
  })

  it.skipIf(REAL_CONTENT)('declares the social image as a JPEG of known size', () => {
    // The box is requested, so width/height/type are facts rather than hints —
    // and a WebP og:image renders as no image at all on LinkedIn and Facebook.
    for (const page of ['index.html', 'impressum/index.html']) {
      const d = doc(page)
      const prop = (name: string) =>
        d.querySelector(`meta[property="${name}"]`)?.getAttribute('content')
      expect(prop('og:image'), page).toContain('fm=jpg')
      expect(prop('og:image'), page).not.toContain('fm=webp')
      expect(prop('og:image:width'), page).toBe('1200')
      expect(prop('og:image:height'), page).toBe('630')
      expect(prop('og:image:type'), page).toBe('image/jpeg')
    }
  })

  it.skipIf(REAL_CONTENT)('resolves each page language through the fall-through', () => {
    // The fixtures set 'en' on the home page, 'de' on the imprint, and nothing
    // at all on datenschutz or siteSettings — so the third case proves the
    // code default rather than a stored value.
    expect(doc('index.html').documentElement.getAttribute('lang')).toBe('en')
    expect(doc('impressum/index.html').documentElement.getAttribute('lang')).toBe('de')
    expect(doc('datenschutz/index.html').documentElement.getAttribute('lang')).toBe('de')
  })

  it('asks for a large image preview where indexed, and excludes where not', () => {
    const robots = (page: string) =>
      doc(page).querySelector('meta[name="robots"]')?.getAttribute('content')
    expect(robots('index.html')).toBe('max-image-preview:large')
    expect(robots('impressum/index.html')).toBe('max-image-preview:large')
    // The 404 excludes itself regardless of content.
    expect(robots('404.html')).toBe('noindex')
  })

  it.skipIf(REAL_CONTENT)('honours the per-page exclusion switch', () => {
    // The fixture sets noIndex on datenschutz only.
    expect(
      doc('datenschutz/index.html').querySelector('meta[name="robots"]')?.getAttribute('content'),
    ).toBe('noindex')
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter site test`
Expected: FAIL — `og:url` is null, `html[lang]` is `de` on `index.html`, `meta[name="robots"]` is null on indexed pages.

- [ ] **Step 3: Replace `Base.astro`'s frontmatter**

Keep the font and style imports and the `VisualEditing` block exactly as they are. Replace everything from `import type {Seo, SiteSettings}` down to the closing `---` with:

```ts
import type {Seo, SiteSettings} from '../lib/content'
import {buildSeo, type OgType} from '../lib/seo'

interface Props {
  title: string
  // The document's own metadata, passed whole rather than field by field: every
  // fall-through to the site-wide default is decided in lib/seo.ts, so adding a
  // field to `seo` does not mean threading a prop through all three pages
  // again. `title` stays with the caller — its fallback is a different sentence
  // per page.
  seo?: Seo | null
  settings: SiteSettings
  /** Only the 404 passes this: a route excluding itself, whatever the content
   *  says. The editor-facing switches live on `seo`. */
  noIndex?: boolean
  /** 'website' for everything that exists today. A post page passes 'article'
   *  and nothing here changes. */
  ogType?: OgType
  /** An array, not one object, because a post page emits Article *and*
   *  BreadcrumbList together. */
  jsonLd?: object[]
}

const {title, seo, settings, noIndex, ogType, jsonLd} = Astro.props

const meta = buildSeo({
  title,
  seo,
  settings,
  pathname: Astro.url.pathname,
  // Typed `URL | undefined`, but astro.config.mjs sets `site` unconditionally
  // for both builds.
  site: Astro.site!,
  noIndex,
  ogType,
})
```

The icon links are emitted unconditionally — see Task 5, Step 3 for why the
routes always produce bytes and can never 404.

- [ ] **Step 4: Replace `Base.astro`'s `<head>`**

Change `<html lang="de">` to `<html lang={meta.lang}>`, and replace the head's contents between `<meta name="viewport" …/>` and `</head>` with:

```astro
    <title>{meta.title}</title>
    {meta.description && <meta name="description" content={meta.description} />}
    <link rel="canonical" href={meta.canonical} />
    <meta name="robots" content={meta.robots} />

    <meta property="og:title" content={meta.title} />
    {meta.description && <meta property="og:description" content={meta.description} />}
    <meta property="og:type" content={meta.ogType} />
    <meta property="og:url" content={meta.canonical} />
    <meta property="og:site_name" content={meta.siteName} />
    <meta property="og:locale" content={meta.ogLocale} />
    {
      meta.image && (
        <>
          <meta property="og:image" content={meta.image.url} />
          <meta property="og:image:width" content={String(meta.image.width)} />
          <meta property="og:image:height" content={String(meta.image.height)} />
          <meta property="og:image:type" content={meta.image.type} />
          {meta.image.alt && <meta property="og:image:alt" content={meta.image.alt} />}
        </>
      )
    }
    <meta name="twitter:card" content={meta.image ? 'summary_large_image' : 'summary'} />

    <link rel="icon" type="image/png" sizes="96x96" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

The `jsonLd` prop is destructured but not yet rendered — Task 6 adds the element. Leaving it unused for one task is deliberate: it keeps the tag change and the script-assertion change in separate reviewable commits.

- [ ] **Step 5: Make the 404 exclude itself**

In `site/src/pages/404.astro`, change the `<Base …>` opening tag to:

```astro
<Base title={`${settings.notFound?.heading} · ${settings.brand}`} settings={settings} noIndex>
```

An HTTP 404 already keeps the page out of an index; this is the cheap belt-and-braces, and it costs one attribute.

- [ ] **Step 6: Run the full site suite**

Run: `pnpm --filter site test`
Expected: PASS. Watch for the pre-existing `loads no third-party subresource` test — the two new `<link>` elements are same-origin and must not trip it.

- [ ] **Step 7: Commit**

```bash
git add site/src/layouts/Base.astro site/src/pages/404.astro site/test/dist.test.ts
git commit -m "$(cat <<'EOF'
feat(seo): emit og:url, og:site_name, og:locale, image dimensions and robots

Base.astro now maps a SeoMeta to tags and derives nothing itself.
`lang` comes from the content instead of a hardcoded "de", which was
wrong on every English page. Indexed pages ask for
max-image-preview:large -- the directive that decides whether Google
shows a full image or a thumbnail.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The favicon and apple-touch-icon routes

Editor-managed art, served from our own origin, with no build tooling.

**Files:**
- Create: `site/src/lib/icon.ts`
- Create: `site/src/pages/favicon.png.ts`
- Create: `site/src/pages/apple-touch-icon.png.ts`
- Modify: `site/public/_redirects`
- Modify: `site/test/dist.test.ts`

**Interfaces:**
- Consumes: `getSiteSettings` from `./content` (Task 1), `cdnSrcFor` from `./image` (Task 2), `settings.icon` (Task 1).
- Produces: `iconResponse(client: SanityClient, size: number): Promise<Response>`. The routes `/favicon.png` and `/apple-touch-icon.png`, which Task 4's `<link>` tags and Task 6's `Organization.logo` both point at.

- [ ] **Step 1: Write the failing assertions**

In `site/test/dist.test.ts`, add a new describe block after `describe('built pages', …)`:

```ts
describe('site icon', () => {
  // Prerendered from Sanity at build time, exactly like robots.txt and
  // sitemap.xml, so a visitor fetches the icon from our own origin and never
  // contacts Sanity for it. That matters most on the legal pages and the 404,
  // which load no images at all.
  const ICONS = ['favicon.png', 'apple-touch-icon.png']

  it('emits both icon files as real PNGs, whether or not one was uploaded', () => {
    // Unconditional on purpose, real content included. The routes never 404:
    // a prerendered endpoint writes its body to dist/ whatever the status and
    // Cloudflare serves that file with 200, so "no icon yet" has to mean valid
    // placeholder bytes rather than an empty file answering 200.
    for (const icon of ICONS) {
      const path = join(DIST, icon)
      expect(existsSync(path), icon).toBe(true)
      const magic = [...readFileSync(path).subarray(0, 8)]
      expect(magic, icon).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    }
  })

  it('links both from every page', () => {
    for (const page of PAGES) {
      const d = doc(page)
      expect(d.querySelector('link[rel="icon"]')?.getAttribute('href'), page).toBe('/favicon.png')
      expect(
        d.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
        page,
      ).toBe('/apple-touch-icon.png')
    }
  })

  it('redirects the legacy /favicon.ico that crawlers still request', () => {
    // Browsers honouring <link rel="icon"> never ask for it, but crawlers and
    // preview tools do, and without the rule Cloudflare's
    // not_found_handling: "404-page" answers them with the 404 HTML page.
    const redirects = readFileSync(join(import.meta.dirname, '..', 'public', '_redirects'), 'utf8')
    expect(redirects).toContain('/favicon.ico /favicon.png 301')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter site test`
Expected: FAIL — `dist-fixtures/favicon.png` does not exist.

- [ ] **Step 3: Implement the shared responder**

Create `site/src/lib/icon.ts`:

```ts
import type {SanityClient} from '@sanity/client/stega'
import {getSiteSettings} from './content'
import {cdnSrcFor} from './image'

// A 1×1 transparent PNG, 68 bytes. Stands in for the real icon in the two
// cases where there is nothing to fetch: no icon uploaded yet, and fixture
// mode, whose asset ref is a synthetic zero ID. Both still emit a valid PNG —
// see iconResponse for why never 404-ing is the point.
const STUB_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMB/6X1QwYAAAAASUVORK5CYII='

function stub(): Response {
  return new Response(Uint8Array.from(atob(STUB_PNG), (c) => c.charCodeAt(0)), {
    headers: {'content-type': 'image/png'},
  })
}

/** The icon at one square size, as bytes we serve ourselves.
 *
 *  The fetch happens at build time, in CI, where nothing is a Worker — so the
 *  zone's outbound-TLS problem (docs/BACKLOG.md §1.1) never applies, and the
 *  bytes land in dist/ as an ordinary static file. Serving the icon straight
 *  from cdn.sanity.io would instead make *every* page contact Sanity,
 *  including the two legal pages and the 404, which today load no images at
 *  all — a regression against the same promise that made the fonts
 *  self-hosted.
 *
 *  This never returns 404, and that is load-bearing. A prerendered endpoint
 *  writes its body to dist/ whatever the status, and Cloudflare's asset router
 *  then serves that file with HTTP 200 — the exact trap already recorded in
 *  astro.config.mjs for /api/draft-mode/enable, which answered 200 on a route
 *  claiming to be absent. So with no icon uploaded this emits a 1×1
 *  transparent PNG: a blank favicon, which is precisely what the site shows
 *  today, and it becomes the real icon the moment one is uploaded. Nothing
 *  downstream has to reason about whether the file exists. */
export async function iconResponse(client: SanityClient, size: number): Promise<Response> {
  const {icon} = await getSiteSettings(client)
  if (!icon?.asset) return stub()

  // The fixture's asset ref is a synthetic zero ID with nothing behind it.
  if (process.env.SANITY_FIXTURES === '1') return stub()

  const response = await fetch(cdnSrcFor(icon, size, size, 'png'))
  if (!response.ok) {
    throw new Error(
      `Das Website-Icon konnte nicht von Sanity geladen werden (HTTP ${response.status}). ` +
        'Ohne es kann die Website nicht gebaut werden.',
    )
  }
  return new Response(await response.arrayBuffer(), {headers: {'content-type': 'image/png'}})
}
```

Throwing rather than returning a placeholder is deliberate: a broken upload must fail the deploy gate, not ship a blank icon quietly. Same reasoning as `getSiteSettings`'s German build-failure message.

- [ ] **Step 4: Implement the two routes**

Create `site/src/pages/favicon.png.ts`:

```ts
import type {APIRoute} from 'astro'
import {iconResponse} from '../lib/icon'

// 96×96: Google wants a favicon whose dimensions are a multiple of 48px
// square. Deliberately a prerendered endpoint rather than a file in public/ —
// the art is editor-managed in Sanity, and this is the same shape robots.txt.ts
// and sitemap.xml.ts already use to turn Sanity content into a static file.
export const GET: APIRoute = ({locals}) => iconResponse(locals.sanity, 96)
```

Create `site/src/pages/apple-touch-icon.png.ts`:

```ts
import type {APIRoute} from 'astro'
import {iconResponse} from '../lib/icon'

// 180×180 is the size iOS asks for, and it doubles as Organization.logo in the
// JSON-LD — comfortably past Google's 112×112 minimum for a logo, and on our
// own origin, so the structured data names no third-party host.
export const GET: APIRoute = ({locals}) => iconResponse(locals.sanity, 180)
```

- [ ] **Step 5: Add the legacy redirect**

Append to `site/public/_redirects`:

```
/favicon.ico /favicon.png 301
```

- [ ] **Step 6: Run the full site suite**

Run: `pnpm --filter site test`
Expected: PASS, including the two new files existing in `dist-fixtures/` with PNG magic bytes.

- [ ] **Step 7: Commit**

```bash
git add site/src/lib/icon.ts site/src/pages/favicon.png.ts \
        site/src/pages/apple-touch-icon.png.ts site/public/_redirects site/test/dist.test.ts
git commit -m "$(cat <<'EOF'
feat(seo): serve an editor-managed favicon from our own origin

The site had no favicon at all. The art is uploaded in the Studio, but
the bytes are fetched at build time and written into dist/ rather than
linked from cdn.sanity.io -- otherwise every page, including the legal
pages and the 404 that load no images today, would contact Sanity.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `Organization` JSON-LD, and narrowing the no-JavaScript rule

The only task that touches the site's central invariant, so it is the only thing in this commit.

**Files:**
- Modify: `site/test/dist.test.ts:195` (the `ships no JavaScript` test)
- Modify: `site/src/layouts/Base.astro`
- Modify: `site/src/pages/index.astro`

**Interfaces:**
- Consumes: `organizationJsonLd`, `jsonLdScript` from `../lib/seo` (Task 3); `Base.astro`'s `jsonLd` prop (Task 4); `/apple-touch-icon.png` (Task 5).
- Produces: nothing further.

- [ ] **Step 1: Narrow the assertion and add the JSON-LD checks**

In `site/test/dist.test.ts`, replace the `ships no JavaScript` test with:

```ts
  it('ships no executable JavaScript', () => {
    // Narrower than "no <script> elements", not weaker: JSON-LD is a script
    // tag that cannot run, and these two conditions together admit nothing
    // that can. A src would be a third-party subresource (the test above
    // catches that too); any type other than ld+json would be code.
    for (const page of PAGES) {
      const scripts = [...doc(page).querySelectorAll('script')]
      for (const script of scripts) {
        expect(script.getAttribute('src'), `${page} loads a script`).toBeNull()
        expect(script.getAttribute('type'), `${page} runs a script`).toBe(
          'application/ld+json',
        )
      }
    }
  })

  it('emits parseable Organization JSON-LD on the home page only', () => {
    const blocks = [...doc('index.html').querySelectorAll('script[type="application/ld+json"]')]
    expect(blocks).toHaveLength(1)
    // Parsing, not just presence: a malformed builder would otherwise ship
    // invisible garbage that only Google's validator ever notices.
    const json = JSON.parse(blocks[0].textContent!)
    expect(json['@context']).toBe('https://schema.org')
    expect(json['@type']).toBe('Organization')
    expect(json.name.length).toBeGreaterThan(0)
    expect(json.url).toMatch(/^https:\/\//)

    // A knowledge-panel signal belongs on the home page and nowhere else.
    for (const page of ['impressum/index.html', 'datenschutz/index.html', '404.html']) {
      expect(
        doc(page).querySelectorAll('script[type="application/ld+json"]'),
        page,
      ).toHaveLength(0)
    }
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter site test`
Expected: FAIL — `expect(blocks).toHaveLength(1)` receives 0. The narrowed `ships no executable JavaScript` test passes already (there are no scripts yet), which is correct: it must never have been the failing one.

- [ ] **Step 3: Render the JSON-LD**

In `site/src/layouts/Base.astro`, add the `jsonLdScript` import:

```ts
import {buildSeo, jsonLdScript, type OgType} from '../lib/seo'
```

and add this as the last thing in `<head>`, after the icon links:

```astro
    {
      jsonLd?.map((entry) => (
        <script type="application/ld+json" set:html={jsonLdScript(entry)} />
      ))
    }
```

- [ ] **Step 4: Pass it from the home page**

In `site/src/pages/index.astro`, add to the imports:

```ts
import {organizationJsonLd} from '../lib/seo'
```

and change the `<Base …>` opening tag to:

```astro
<Base
  title={title}
  seo={home.seo}
  settings={settings}
  jsonLd={[organizationJsonLd(settings, Astro.site!)]}
>
```

- [ ] **Step 5: Run the full site suite**

Run: `pnpm --filter site test`
Expected: PASS. Both the narrowed script rule and the JSON-LD parse assertions hold.

- [ ] **Step 6: Commit**

```bash
git add site/test/dist.test.ts site/src/layouts/Base.astro site/src/pages/index.astro
git commit -m "$(cat <<'EOF'
feat(seo): emit Organization JSON-LD on the home page

Ties the brand, its contact address and its Instagram profile into one
machine-readable record, with logo pointing at our own icon route
rather than cdn.sanity.io.

The "ships no JavaScript" assertion becomes "ships no *executable*
JavaScript": no script may carry a src, and every script's type must be
exactly application/ld+json. Strictly narrower than a script-tag count,
and it states the invariant the site actually promises.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Record what was deferred, and run the real gate

**Files:**
- Modify: `docs/BACKLOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Add the deferred work to the backlog**

Add a subsection under `## 4. Deliberate non-goals, recorded so they stop resurfacing`, following the numbering already in the file:

```markdown
### 4.3 SEO work deliberately deferred to the blog and the catalog

`docs/superpowers/specs/2026-08-20-seo-social-design.md` §11 has the detail.
Not built, and not because it was overlooked:

- **`<lastmod>` in the sitemap.** `sitemap.xml.ts` argues against it for three
  routes and search engines discount an unverifiable value. It becomes worth the
  cost when `_updatedAt` means something — i.e. when there are posts.
- **RSS/Atom, `Article` JSON-LD, `og:type=article`.** Nothing to put in a feed
  yet. All three plug into `lib/seo.ts` as a new `OgType` and a builder beside
  `organizationJsonLd`; `Base.astro`'s head does not move again.
- **`Product` JSON-LD.** Blocked on a commercial question, not a technical one:
  is there a price, is there stock, does a visitor buy on-site or by Instagram
  DM. `Offer` follows from that answer and earns nothing before it.
- **`hreflang`.** The site is mixed-language by design — the German imprint is
  not an alternate of the English home page — so there are no alternate pairs to
  declare. This refines `2026-08-16-page-builder-design.md`, which asserted the
  site is German throughout; that was true of the Studio, never of the copy.
- **A separate wordmark for `Organization.logo`.** One square `icon` field
  serves as both favicon and logo. A knowledge panel would rather have the
  wordmark; add a second field if that ever matters.
- **Generated social cards.** Compositing text onto an image needs a rasterizer
  at build time and Sanity's image API cannot do it. The per-page `ogImage`
  field covers the case that matters.
```

- [ ] **Step 2: Run the full gate**

Run: `pnpm verify`
Expected: PASS — typegen drift check clean (Task 1 committed the regenerated types), studio lint/typecheck/tests, `astro check`, site tests.

**Make sure `pnpm dev` is not running.** Its typegen watcher rewrites `site/src/sanity.types.ts` underneath the drift check.

- [ ] **Step 3: Commit**

```bash
git add docs/BACKLOG.md
git commit -m "$(cat <<'EOF'
docs: record the SEO work deferred to the blog and the catalog

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify against real content before deploying**

Run: `pnpm build:site:deploy`
Expected: PASS. `iconResponse` throws — failing this gate — only if `siteSettings.icon` is set but its asset cannot be fetched. A site with no icon uploaded builds fine and ships the 1×1 placeholder.

Two manual follow-ups for the owner, neither of which code can do:

1. **Upload the icon** in the Studio under *Website-Einstellungen → Marke → Website-Icon*. Square, at least 512×512. Until then the favicon is a blank 1×1 placeholder — the same blank tab icon the site shows today, so nothing regresses, but nothing improves either.
2. **Set the language** on the home page to *Englisch* (*Suchmaschinen → Sprache*). The code default is `de`, deliberately — see Task 1, Step 1 — so the English home page keeps claiming German until this is set.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/seo-social-metadata
gh pr create --base main --title 'feat(seo): social cards, structured data and a real favicon' --body "$(cat <<'EOF'
Implements `docs/superpowers/specs/2026-08-20-seo-social-design.md`.

**Defects fixed**
- `og:image` was WebP, which LinkedIn and Facebook silently render as no image.
- No favicon existed at all.
- `<html lang="de">` was hardcoded on pages written in English.

**Added**
- `og:url`, `og:site_name`, `og:locale`, `og:image:width/height/type`.
- `max-image-preview:large` on indexed pages.
- `Organization` JSON-LD on the home page.
- Per-page language, inheriting the existing siteSettings fall-through.
- An editor-managed icon, fetched at build time and served same-origin.

**Invariant change:** `dist.test.ts`'s "ships no JavaScript" becomes "ships no
*executable* JavaScript" — no script may carry a `src`, and every script's type
must be exactly `application/ld+json`. Strictly narrower than the old
script-tag count.

**Needs two Studio edits after merge:** upload the icon, and set the home
page's language to Englisch. Both are called out in the plan's Task 7.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

**Spec coverage.** Every section maps to a task: §2.1 → Task 2; §2.2 → Task 5; §2.3 → Tasks 1, 3, 4; §2.4 → Task 4; §2.5 → Task 6; §3 → Task 3; §4 → Tasks 1, 3; §5 → Task 5; §6 → Task 6; §7 → Task 1; §8 → Task 1; §9 → Tasks 2–6; §10 → all; §11 → Task 7.

**Deviations from the spec, both deliberate.**

1. **`lib/icon.ts` is a file the spec did not name.** §5 described two endpoint routes without saying where their shared body lives. Duplicating the fetch-and-throw across both routes for the sake of matching the spec's file list would be worse; one two-use helper is the smaller thing.
2. **`jsonLdScript` is a function the spec did not name.** §6 specified the `<script>` element but not that a content string containing `</script>` would close it. Escaping `<` is a correctness fix, not scope creep.
3. **The icon routes never 404, contradicting spec §5's "the routes respond 404 and no `<link>` is emitted".** That instruction would have reproduced a bug this repo already hit: `astro.config.mjs` records that a prerendered endpoint writes its body to `dist/` whatever the status, and Cloudflare's asset router then serves that file with HTTP 200 — which is why `/api/draft-mode/enable` had to be injected rather than guarded. A 404 branch here would ship a zero-byte `favicon.png` answering 200. So "no icon" emits a 1×1 transparent PNG instead, the links are unconditional, and `Base.astro` needs no `hasIcon` gate. `Organization.logo` is still omitted when no icon is set, since a blank placeholder is not a logo. Spec §5 has been corrected to match, so the two documents now agree.

**Not deviations, worth flagging to a reviewer.**

- `buildSeo` passes `title` straight through rather than resolving it. That preserves the existing comment in `Base.astro` — the fallback sentence differs per page, so it stays with the caller. `SeoMeta.title` exists so `<title>` and `og:title` are guaranteed to agree.
- Task 4 destructures `jsonLd` without rendering it, and Task 6 renders it. One unused prop for one task, so the invariant change lands in its own reviewable commit.
