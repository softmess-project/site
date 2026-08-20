import {describe, expect, it} from 'vitest'
import {getHomePage, getPage, getPageSlugs, getSiteSettings} from '../src/lib/content'
import {publishedClient} from '../src/lib/sanity'
import {socialSrcFor, srcFor} from '../src/lib/image'

// Must match the flag the fixture build ran with — `pnpm test` sets
// PROXY_IMAGES=1, and vitest.config.ts forwards it into the test env.
const PROXIED = process.env.PROXY_IMAGES === '1'

describe('content layer in fixture mode', () => {
  it('returns site settings from fixtures', async () => {
    const settings = await getSiteSettings(publishedClient)
    expect(settings.brand).toBe('softmess')
    expect(settings.email).toBe('hi@softmess.de')
  })

  it('returns the home page with a hero block', async () => {
    const home = await getHomePage(publishedClient)
    expect(home.pageBuilder).not.toBeNull()
    const hero = home.pageBuilder?.[0]
    expect(hero?._type).toBe('hero')
  })

  it('lists page slugs', async () => {
    expect(await getPageSlugs(publishedClient)).toEqual(['impressum', 'datenschutz'])
  })

  it('finds a page by slug and misses cleanly', async () => {
    expect((await getPage(publishedClient, 'impressum'))?.title).toBe('Impressum')
    expect(await getPage(publishedClient, 'nope')).toBeNull()
  })

  it('flattens slug to a string, matching the live query projection', async () => {
    // PAGE_QUERY projects `"slug": slug.current`, so the live shape is a
    // plain string even though the fixture document stores `slug: {current}`.
    const page = await getPage(publishedClient, 'impressum')
    expect(page?.slug).toBe('impressum')
  })

  it('builds a proxied image url from an image ref without network access', () => {
    const url = srcFor(
      {
        _type: 'image',
        asset: {
          _type: 'reference',
          _ref: 'image-0000000000000000000000000000000000000000-966x1207-jpg',
        },
      },
      380,
      475,
    )
    // PROXY_IMAGES is set by `pnpm test`, so the builder's cdn.sanity.io origin
    // is rewritten onto /cdn here. The transform params ride along untouched
    // either way, which is what this test is really about.
    expect(url).not.toContain('cdn.sanity.io')
    expect(url.split('?')[0]).toBe(
      '/cdn/images/85i3osnk/production/0000000000000000000000000000000000000000-966x1207.jpg',
    )
    expect(url).toContain('w=380')
    expect(url).toContain('h=475')
    expect(url).toContain('fm=webp')
  })

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
})
