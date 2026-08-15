import {defineQuery} from 'groq'
import {client} from './sanity'
import type {
  HOME_PAGE_QUERY_RESULT,
  LEGAL_PAGE_QUERY_RESULT,
  SITE_SETTINGS_QUERY_RESULT,
} from '../sanity.types'

import siteSettingsFixture from '../../test/fixtures/siteSettings.json'
import homePageFixture from '../../test/fixtures/homePage.json'
import legalPagesFixture from '../../test/fixtures/legalPages.json'

// Query results, not raw documents — a projection returns a subset, and the
// `[0]` in each singleton query makes the result nullable. Components import
// these aliases from here rather than reaching into sanity.types themselves.
export type SiteSettings = NonNullable<SITE_SETTINGS_QUERY_RESULT>
export type HomePage = NonNullable<HOME_PAGE_QUERY_RESULT>
export type LegalPage = NonNullable<LEGAL_PAGE_QUERY_RESULT>

const USE_FIXTURES = process.env.SANITY_FIXTURES === '1'

export const SITE_SETTINGS_QUERY = defineQuery(`
  *[_id == "siteSettings"][0]{
    brand, tagline, email, instagram, instagramHandle, copyright,
    seo{title, description, ogImage}
  }
`)

export const HOME_PAGE_QUERY = defineQuery(`
  *[_id == "homePage"][0]{
    heading, statement, body,
    charm{alt, asset},
    actions[]{_key, label, href}
  }
`)

export const LEGAL_PAGE_SLUGS_QUERY = defineQuery(`
  *[_type == "legalPage" && defined(slug.current)].slug.current
`)

export const LEGAL_PAGE_QUERY = defineQuery(`
  *[_type == "legalPage" && slug.current == $slug][0]{
    title, kicker, body, "slug": slug.current
  }
`)

export async function getSiteSettings(): Promise<SiteSettings> {
  if (USE_FIXTURES) return siteSettingsFixture as unknown as SiteSettings
  return (await client.fetch(SITE_SETTINGS_QUERY)) as SiteSettings
}

export async function getHomePage(): Promise<HomePage> {
  if (USE_FIXTURES) return homePageFixture as unknown as HomePage
  return (await client.fetch(HOME_PAGE_QUERY)) as HomePage
}

export async function getLegalPageSlugs(): Promise<string[]> {
  if (USE_FIXTURES) {
    return (legalPagesFixture as Array<{slug: {current: string}}>).map((p) => p.slug.current)
  }
  return (await client.fetch(LEGAL_PAGE_SLUGS_QUERY)) as string[]
}

export async function getLegalPage(slug: string): Promise<LegalPage | null> {
  if (USE_FIXTURES) {
    const match = (legalPagesFixture as Array<{slug: {current: string}}>).find(
      (page) => page.slug.current === slug,
    )
    return (match as unknown as LegalPage) ?? null
  }
  return ((await client.fetch(LEGAL_PAGE_QUERY, {slug})) as LegalPage) ?? null
}
