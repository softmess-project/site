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
    siteName: settings.brand ?? '',
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
