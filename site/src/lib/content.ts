import {defineQuery} from 'groq'
import type {SanityClient} from '@sanity/client/stega'
import type {
  HOME_PAGE_QUERY_RESULT,
  NAV_QUERY_RESULT,
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
export type Nav = NonNullable<NAV_QUERY_RESULT>

const USE_FIXTURES = process.env.SANITY_FIXTURES === '1'

export const SITE_SETTINGS_QUERY = defineQuery(`
  *[_id == "siteSettings" && _type == "siteSettings"][0]{
    brand, tagline, email, instagram, instagramHandle, copyright,
    backLabel, instagramLabel, notFound{heading, body},
    seo{title, description, ogImage}
  }
`)

// `_key` and `_type` must be projected on every array member — they are the
// render key and the switch discriminant, and stega source maps need `_key`
// to resolve an array path.
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

export async function getNav(client: SanityClient): Promise<Nav> {
  if (USE_FIXTURES) {
    const settings = siteSettingsFixture as unknown as Nav
    return {headerLinks: settings.headerLinks ?? [], footerLinks: settings.footerLinks ?? []}
  }
  return ((await client.fetch(NAV_QUERY)) as Nav) ?? {headerLinks: [], footerLinks: []}
}
