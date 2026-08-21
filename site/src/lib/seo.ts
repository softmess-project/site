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
  /** The decision behind `robots`, kept as the boolean it already is. `robots`
   *  is a directive list free to grow (max-image-preview:large today, and the
   *  branch below records that nofollow was weighed); a consumer that reads
   *  the string instead silently stops working the day it does. */
  noIndex: boolean
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
    siteName: settings.brand ?? '',
    noIndex,
    robots,
    // socialSrcFor is absolute by construction and never proxied, so unlike
    // the on-page helpers this needs no resolving against `site`.
    image: source?.asset
      ? {url: socialSrcFor(source), alt: source.alt ?? null, ...SOCIAL_IMAGE}
      : null,
  }
}

/** Every node's `@id` is a fragment of the site's own URL, so the identifiers
 *  a consumer joins on are spelled in exactly one place. Three of the five
 *  uses are references rather than definitions — a typo in any of them is a
 *  dangling edge, which is invisible in the rendered page. */
const nodeId = (site: URL, name: string) => `${site.href}#${name}`

/** Read once and shared by the Organization and WebSite nodes: they must agree
 *  on what the brand is called, whatever fallback this rule grows. */
const brandName = (settings: SiteSettings) => clean(settings.brand ?? undefined) ?? ''

/** The brand as one machine-readable record: what it is called, where it
 *  lives, how to reach it, and which social profile is the same entity.
 *
 *  A node inside the graph below rather than a document of its own, so it
 *  carries an `@id` and no `@context`: `WebSite.publisher` and the home page's
 *  `WebPage.about` both point here by reference instead of repeating it.
 *
 *  Every value is stegaClean'd. A source-map payload is invisible in a meta
 *  tag and harmless there, but inside structured data it is a string a
 *  validator reads. Nothing here is Portable Text, so cleaning is safe. */
export function organizationNode(settings: SiteSettings, site: URL): Record<string, unknown> {
  const email = clean(settings.email ?? undefined)
  const instagram = clean(settings.instagram ?? undefined)
  return {
    '@type': 'Organization',
    '@id': nodeId(site, 'organization'),
    name: brandName(settings),
    url: site.href,
    ...(email ? {email} : {}),
    ...(instagram ? {sameAs: [instagram]} : {}),
    // Our own origin, not a cdn.sanity.io URL: keeps a third-party host out of
    // the structured data. The 512px manifest icon rather than the 180px
    // apple-touch one — both clear Google's 112×112 minimum, and a knowledge
    // panel has more to work with at 512. Unconditional now that the file is a
    // static asset: there is no "not uploaded yet" state left to guard.
    logo: new URL('/web-app-manifest-512x512.png', site).href,
  }
}

/** The page's structured data as one connected graph: the brand, the site it
 *  publishes, and this page within it. Three `@id`-linked nodes in a single
 *  block rather than three sibling scripts — a consumer joins them without
 *  having to merge documents, and the block stays self-contained per page.
 *
 *  Neither `WebSite` nor `WebPage` earns a Google rich result; this is entity
 *  clarity, not a SERP feature. A type that *does* earn one — `Article`,
 *  `BreadcrumbList` — is a fourth node appended here, by the commit that adds
 *  the route that needs it.
 *
 *  Built from `SeoMeta`, not from raw content, so the graph and the meta tags
 *  can never disagree about the title, the language or the canonical URL.
 *  Returns null for a page excluded from search: structured data nobody will
 *  read, on the 404, either editor switch, and the preview Worker alike. */
export function siteGraph(
  meta: SeoMeta,
  settings: SiteSettings,
  site: URL,
): {'@context': string; '@graph': Record<string, unknown>[]} | null {
  if (meta.noIndex) return null

  // buildSeo leaves these alone on purpose — a stega payload is invisible in a
  // meta tag. Here it would be part of the string a validator reads.
  const name = clean(meta.title) ?? ''
  const description = clean(meta.description ?? undefined)

  // Derived from the canonical URL, not from a pathname special case: the one
  // statement that tells a consumer which URL is the entity's own home.
  const isHome = meta.canonical === site.href

  const organization = nodeId(site, 'organization')
  const website = nodeId(site, 'website')

  return {
    '@context': 'https://schema.org',
    '@graph': [
      organizationNode(settings, site),
      {
        '@type': 'WebSite',
        '@id': website,
        url: site.href,
        name: brandName(settings),
        publisher: {'@id': organization},
        // Deliberately no inLanguage. The site is mixed-language by design —
        // a German imprint under an English home page — so a single value
        // here would be false for half the routes. Only the page knows.
      },
      {
        '@type': 'WebPage',
        '@id': `${meta.canonical}#webpage`,
        url: meta.canonical,
        name,
        ...(description ? {description} : {}),
        isPartOf: {'@id': website},
        ...(isHome ? {about: {'@id': organization}} : {}),
        inLanguage: meta.lang,
      },
    ],
  }
}

/** Serialize the graph for `set:html`. `<` is escaped because a
 *  content string containing `</script>` would otherwise close the element and
 *  turn editor text into markup. `<` is a JSON escape, so the result still
 *  parses as the same value. */
export function jsonLdScript(graph: object): string {
  return JSON.stringify(graph).replace(/</g, '\\u003c')
}
