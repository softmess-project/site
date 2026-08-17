import {describe, expect, it} from 'vitest'
import {getHomePage, getPage, getPageSlugs, getSiteSettings} from '../src/lib/content'
import {publishedClient} from '../src/lib/sanity'
import {srcFor} from '../src/lib/image'

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
    // Same-origin: the builder's cdn.sanity.io origin is rewritten onto /cdn,
    // which src/worker.ts proxies. The transform params ride along untouched.
    expect(url).not.toContain('cdn.sanity.io')
    expect(url.split('?')[0]).toBe(
      '/cdn/images/85i3osnk/production/0000000000000000000000000000000000000000-966x1207.jpg',
    )
    expect(url).toContain('w=380')
    expect(url).toContain('h=475')
    expect(url).toContain('fm=webp')
  })
})
