import {defineQuery} from 'groq'
import type {SanityClient} from '@sanity/client/stega'
import type {
  HOME_PAGE_QUERY_RESULT,
  PAGE_QUERY_RESULT,
  SITE_SETTINGS_QUERY_RESULT,
} from '../sanity.types'

import siteSettingsFixture from '../../test/fixtures/siteSettings.json'
import homePageFixture from '../../test/fixtures/homePage.json'
import pagesFixture from '../../test/fixtures/pages.json'

// Query results, not raw documents — a projection returns a subset, and the
// `[0]` in each singleton query makes the result nullable. Components import
// these aliases from here rather than reaching into sanity.types themselves.
export type SiteSettings = NonNullable<SITE_SETTINGS_QUERY_RESULT>
export type HomePage = NonNullable<HOME_PAGE_QUERY_RESULT>
export type Page = NonNullable<PAGE_QUERY_RESULT>

// Derived, never hand-written: a change to LINK_PROJECTION or SEO_PROJECTION
// has to surface as a type error in the components rather than as a blank spot
// on the page.
export type NavLink = NonNullable<SiteSettings['headerLinks']>[number]
export type Seo = NonNullable<Page['seo']>

const USE_FIXTURES = process.env.SANITY_FIXTURES === '1'

const SEO_PROJECTION = `seo{title, description, ogImage{alt, asset}}`

// A link resolves to the same `{label, href}` shape wherever it appears — a
// button, a nav entry, a rich-text annotation — so the components never learn
// that internal and external links are stored differently. `href` is computed,
// but stega leaves it alone: its default filter denylists the key `href` and
// skips anything URL-shaped, so no invisible characters land in an attribute.
const LINK_HREF = `select(
  linkType == "external" => href,
  defined(page->slug.current) => "/" + page->slug.current
)`

// Drops links whose target does not resolve. The Studio marks the reference
// required, but that validates the link, not the target: a page that exists
// only as a draft is invisible on the published perspective the static build
// fetches with, so it dereferences to null. Without this filter the build ships
// `<a href="/null">` — invisible, clickable, and a 404. Three cases reach it:
// an external link with no address, an internal one whose page was deleted or
// never published, and a link switched to external while a stale page reference
// is still on the document (the Studio hides the losing field, it does not
// clear it). Asking LINK_HREF whether it produced anything, rather than
// restating its branches, is what makes all three agree — the filter cannot
// fall out of step with the value it guards.
const LINK_FILTER = `defined(${LINK_HREF})`

// Resolves each link annotation to a plain href, so the Portable Text renderer
// keeps reading `markDef.href` and never learns that references exist. The
// spread preserves every other mark untouched: stega source maps live in this
// tree, and stegaClean-ing Portable Text destroys the overlays.
const MARK_DEFS_PROJECTION = `markDefs[]{..., _type == "link" => {"href": ${LINK_HREF}}}`

// The filter and the resolved shape together, so a link reads the same whether
// it is a block's button or a navigation entry — including the label fallback,
// which would otherwise be easy to change in one place only.
const LINK_PROJECTION = `[${LINK_FILTER}]{_key, "label": coalesce(label, page->title), "href": ${LINK_HREF}}`

// The navigation rides along on the document it lives on: Base.astro already
// has `settings` in hand, so a separate query for the same `siteSettings`
// document would be a serialized extra round trip on every rendered page.
export const SITE_SETTINGS_QUERY = defineQuery(`
  *[_id == "siteSettings" && _type == "siteSettings"][0]{
    brand, tagline, email, instagram, instagramHandle, copyright,
    backLabel, instagramLabel, notFound{heading, body},
    headerLinks${LINK_PROJECTION},
    footerLinks${LINK_PROJECTION},
    ${SEO_PROJECTION}
  }
`)

// `_key` and `_type` must be projected on every array member — they are the
// render key and the switch discriminant, and stega source maps need `_key`
// to resolve an array path.
const PAGE_BUILDER_PROJECTION = `
  pageBuilder[]{
    _key, _type,
    _type == "hero" => {heading, statement, body, image{alt, asset}, imagePosition, actions${LINK_PROJECTION}},
    _type == "richText" => {content[]{..., ${MARK_DEFS_PROJECTION}}, width},
    _type == "imageText" => {image{alt, asset}, heading, body, imagePosition, background, actions${LINK_PROJECTION}},
    _type == "gallery" => {images[]{_key, alt, asset}, columns},
    _type == "cta" => {heading, body, background, actions${LINK_PROJECTION}}
  }
`

export const HOME_PAGE_QUERY = defineQuery(`
  *[_id == "homePage" && _type == "homePage"][0]{${SEO_PROJECTION}, ${PAGE_BUILDER_PROJECTION}}
`)

export const PAGE_SLUGS_QUERY = defineQuery(`
  *[_type == "page" && defined(slug.current)].slug.current
`)

export const PAGE_QUERY = defineQuery(`
  *[_type == "page" && slug.current == $slug][0]{
    title, "slug": slug.current, ${SEO_PROJECTION},
    ${PAGE_BUILDER_PROJECTION}
  }
`)

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

export async function getHomePage(client: SanityClient): Promise<HomePage> {
  if (USE_FIXTURES) return homePageFixture as unknown as HomePage
  const home = (await client.fetch(HOME_PAGE_QUERY)) as HomePage | null
  if (!home) {
    throw new Error(
      'Das Dokument "Startseite" fehlt in Sanity. Ohne es kann die Website nicht gebaut werden.',
    )
  }
  return home
}

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
