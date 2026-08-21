import {afterEach, describe, expect, it, vi} from 'vitest'
import config, {resolvePreviewOrigin, resolveSiteOrigin} from './sanity.config'

// Fake action components: only the `action` id sanity's built-ins expose
// statically is relevant to the filter, so that's all these need.
const previous = [{action: 'publish'}, {action: 'delete'}, {action: 'duplicate'}] as never

describe('resolvePreviewOrigin', () => {
  it('prefers the build-time variable', () => {
    expect(
      resolvePreviewOrigin({SANITY_STUDIO_PREVIEW_ORIGIN: 'https://from-build'}, undefined),
    ).toBe('https://from-build')
  })

  it('falls back to process.env when the build did not inline it', () => {
    expect(resolvePreviewOrigin({DEV: false}, 'https://from-process')).toBe('https://from-process')
  })

  it('uses localhost only in dev', () => {
    expect(resolvePreviewOrigin({DEV: true}, undefined)).toBe('http://localhost:4321')
  })

  // The regression: a production build with neither source set used to point
  // Presentation at localhost, which loads silently and never connects.
  it('never points a production build at localhost', () => {
    expect(resolvePreviewOrigin({DEV: false}, undefined)).toBe(
      'https://softmess-preview.9dev.workers.dev',
    )
    expect(resolvePreviewOrigin(undefined, undefined)).toBe(
      'https://softmess-preview.9dev.workers.dev',
    )
  })
})

describe('document.actions', () => {
  it('drops delete and duplicate for singleton types', () => {
    const result = config.document!.actions!(previous, {schemaType: 'siteSettings'} as never)

    expect(result.map((a: {action?: string}) => a.action)).toEqual(['publish'])
  })

  it('leaves other types untouched', () => {
    const result = config.document!.actions!(previous, {schemaType: 'post'} as never)

    expect(result.map((a: {action?: string}) => a.action)).toEqual([
      'publish',
      'delete',
      'duplicate',
    ])
  })
})

describe('resolveSiteOrigin', () => {
  it("drops the studio label from the Studio's own hostname", () => {
    expect(resolveSiteOrigin('studio.softmess.de')).toBe('https://softmess.de')
  })

  // `pnpm dev` and any preview host: nothing to derive, and the published page
  // is still on the production domain.
  it('falls back to production off a studio subdomain', () => {
    expect(resolveSiteOrigin('localhost')).toBe('https://softmess.de')
  })
})

describe('document.productionUrl', () => {
  const resolveFor = (document: Record<string, unknown>) => {
    vi.stubGlobal('window', {location: {hostname: 'studio.softmess.de'}})

    return config.document!.productionUrl!(undefined, {document} as never)
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('links a page at its slug', async () => {
    await expect(resolveFor({_type: 'page', slug: {current: 'impressum'}})).resolves.toBe(
      'https://softmess.de/impressum',
    )
  })

  it('links the home page at the root', async () => {
    await expect(resolveFor({_type: 'homePage'})).resolves.toBe('https://softmess.de/')
  })

  // Returning the previous value (undefined) is what hides the menu item, and a
  // link to /undefined is exactly what must never reach an editor.
  it('offers nothing for a page without a slug', async () => {
    await expect(resolveFor({_type: 'page'})).resolves.toBeUndefined()
  })

  it('offers nothing for documents that have no page of their own', async () => {
    await expect(resolveFor({_type: 'siteSettings'})).resolves.toBeUndefined()
  })
})
