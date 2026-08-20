import {describe, expect, it} from 'vitest'
import {vercelStegaCombine, vercelStegaSplit} from '@vercel/stega'
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
function settings(seo: Record<string, unknown> | null = null, extra: Record<string, unknown> = {}) {
  return {brand: 'softmess', seo, ...extra} as unknown as SiteSettings
}

// Only the fields under test. Cast through `unknown` rather than fabricating a
// whole Seo: TypeGen emits every projected field as a required, nullable
// property, so a partial literal is assignable in neither direction.
function seo(fields: Record<string, unknown>): Seo {
  return fields as unknown as Seo
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
    expect(build({seo: seo({description: 'page'})}).description).toBe('page')
    expect(build({settings: settings({description: 'site'})}).description).toBe('site')
    expect(build().description).toBeNull()
  })
})

describe('language', () => {
  it('prefers the page language, then the site default', () => {
    expect(build({seo: seo({language: 'en'})}).lang).toBe('en')
    expect(build({settings: settings({language: 'en'})}).lang).toBe('en')
  })

  it('falls back to de when nothing is set anywhere', () => {
    // Not 'en'. `initialValue` never touched documents that already existed,
    // so absent must mean what the site renders today, or the German imprint
    // gets silently relabelled on the next build.
    expect(build().lang).toBe('de')
  })

  it('ignores a value that is not a known language', () => {
    expect(build({seo: seo({language: 'fr'})}).lang).toBe('de')
  })

  it('maps the language to an Open Graph locale', () => {
    expect(build({seo: seo({language: 'en'})}).ogLocale).toBe('en_US')
    expect(build({seo: seo({language: 'de'})}).ogLocale).toBe('de_DE')
  })
})

describe('robots', () => {
  it('asks for a large image preview when the page is indexed', () => {
    // The directive that decides whether Google may show a full image rather
    // than a thumbnail — the whole point, for a brand whose product is visual.
    expect(build().robots).toBe('max-image-preview:large')
  })

  it('excludes the page for any of the three content switches', () => {
    expect(build({seo: seo({noIndex: true})}).robots).toBe('noindex')
    expect(build({settings: settings({noIndex: true})}).robots).toBe('noindex')
    expect(build({noIndex: true}).robots).toBe('noindex')
  })

  it('never adds nofollow', () => {
    // An excluded page may still link to pages that should be crawled.
    expect(build({noIndex: true}).robots).not.toContain('nofollow')
  })

  it('excludes the page when PREVIEW is set, and restores the flag afterwards', () => {
    // If this branch is ever dropped from seo.ts's expression, the preview
    // Worker on workers.dev starts emitting max-image-preview:large on draft
    // content, and robots.txt's Disallow is the only thing left standing
    // between unpublished pages and Google.
    const env = import.meta.env as {PREVIEW?: boolean}
    const original = env.PREVIEW
    try {
      env.PREVIEW = true
      expect(build().robots).toBe('noindex')
    } finally {
      env.PREVIEW = original
    }
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
    const page = seo({ogImage: {asset: IMAGE_REF, alt: 'page alt'}})
    expect(build({seo: page}).image?.alt).toBe('page alt')
    expect(
      build({settings: settings({ogImage: {asset: IMAGE_REF, alt: 'site alt'}})}).image?.alt,
    ).toBe('site alt')
    expect(build().image).toBeNull()
  })

  it('declares the box it actually requested, as JPEG', () => {
    const image = build({seo: seo({ogImage: {asset: IMAGE_REF}})}).image
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
    const withIcon = organizationJsonLd(settings(null, {icon: {asset: IMAGE_REF}}), SITE) as Record<
      string,
      unknown
    >
    expect(withIcon.logo).toBe('https://softmess.de/apple-touch-icon.png')
    expect(organizationJsonLd(settings(), SITE)).not.toHaveProperty('logo')
  })

  it('omits email and sameAs rather than emitting them empty', () => {
    const json = organizationJsonLd(settings(), SITE)
    expect(json).not.toHaveProperty('email')
    expect(json).not.toHaveProperty('sameAs')
  })

  it('strips stega source-map payloads, since a validator reads this string', () => {
    // clean() runs on every value here for exactly this reason: a stega
    // payload is invisible in a meta tag but becomes part of the string a
    // structured-data validator sees. Pin it so dropping clean() is caught.
    const brand = vercelStegaCombine('softmess', {origin: 'test', href: '/', editUrl: '/edit'})
    const json = organizationJsonLd(settings(null, {brand}), SITE) as Record<string, unknown>
    const {cleaned, encoded} = vercelStegaSplit(json.name as string)
    expect(encoded).toBe('')
    expect(cleaned).toBe('softmess')
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
