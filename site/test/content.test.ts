import {describe, expect, it} from 'vitest'
import {getHomePage, getLegalPage, getLegalPageSlugs, getSiteSettings} from '../src/lib/content'
import {urlFor} from '../src/lib/image'

describe('content layer in fixture mode', () => {
  it('returns site settings from fixtures', async () => {
    const settings = await getSiteSettings()
    expect(settings.brand).toBe('softmess')
    expect(settings.email).toBe('hi@softmess.de')
  })

  it('returns the home page with two body paragraphs and two actions', async () => {
    const home = await getHomePage()
    expect(home.statement).toBe('follow the white rabbit.')
    expect(home.body).toHaveLength(2)
    expect(home.actions).toHaveLength(2)
    expect(home.actions?.[0].href).toContain('instagram.com')
  })

  it('lists legal page slugs', async () => {
    expect(await getLegalPageSlugs()).toEqual(['imprint', 'privacy'])
  })

  it('finds a legal page by slug and misses cleanly', async () => {
    expect((await getLegalPage('imprint'))?.title).toBe('imprint')
    expect(await getLegalPage('nope')).toBeNull()
  })

  it('builds a Sanity CDN url from an image ref without network access', () => {
    const url = urlFor({
      _type: 'image',
      asset: {_type: 'reference', _ref: 'image-0000000000000000000000000000000000000000-966x1207-jpg'},
    })
      .width(380)
      .format('webp')
      .url()
    expect(url).toContain('cdn.sanity.io')
    expect(url).toContain('w=380')
    expect(url).toContain('fm=webp')
  })
})
