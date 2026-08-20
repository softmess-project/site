import {describe, expect, it} from 'vitest'
import {vercelStegaCombine, vercelStegaSplit} from '@vercel/stega'
import {buildSeo, jsonLdScript, organizationNode, siteGraph} from '../src/lib/seo'
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

  it('reports the exclusion as a boolean as well as a directive string', () => {
    // `robots` is a directive *list* — it already carries
    // max-image-preview:large, and the comment above it records that nofollow
    // was considered. Any consumer that decides something from it must read
    // this boolean, not string-match a field whose spelling is free to grow.
    expect(build({noIndex: true}).noIndex).toBe(true)
    expect(build().noIndex).toBe(false)
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

describe('organization node', () => {
  it('emits the brand, its contact address and its Instagram profile', () => {
    const json = organizationNode(
      settings(null, {email: 'hi@softmess.de', instagram: 'https://instagram.com/softmess'}),
      SITE,
    ) as Record<string, unknown>
    expect(json['@type']).toBe('Organization')
    // An @id, because WebSite.publisher and the home page's WebPage.about
    // both point at this node by reference rather than repeating it.
    expect(json['@id']).toBe('https://softmess.de/#organization')
    // No @context: the node lives inside a @graph that declares it once.
    expect(json).not.toHaveProperty('@context')
    expect(json.name).toBe('softmess')
    expect(json.url).toBe('https://softmess.de/')
    expect(json.email).toBe('hi@softmess.de')
    expect(json.sameAs).toEqual(['https://instagram.com/softmess'])
  })

  it('points logo at our own icon route, and omits it when no icon is set', () => {
    // Our own origin, not cdn.sanity.io: 180×180 clears Google's 112×112
    // minimum and keeps a third-party host out of the structured data.
    const withIcon = organizationNode(settings(null, {icon: {asset: IMAGE_REF}}), SITE) as Record<
      string,
      unknown
    >
    expect(withIcon.logo).toBe('https://softmess.de/apple-touch-icon.png')
    expect(organizationNode(settings(), SITE)).not.toHaveProperty('logo')
  })

  it('omits email and sameAs rather than emitting them empty', () => {
    const json = organizationNode(settings(), SITE)
    expect(json).not.toHaveProperty('email')
    expect(json).not.toHaveProperty('sameAs')
  })

  it('strips stega source-map payloads, since a validator reads this string', () => {
    // clean() runs on every value here for exactly this reason: a stega
    // payload is invisible in a meta tag but becomes part of the string a
    // structured-data validator sees. Pin it so dropping clean() is caught.
    const brand = vercelStegaCombine('softmess', {origin: 'test', href: '/', editUrl: '/edit'})
    const json = organizationNode(settings(null, {brand}), SITE) as Record<string, unknown>
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

describe('site graph', () => {
  // The three nodes are built from a SeoMeta, not from raw content, so the
  // graph and the meta tags can never disagree about the title, the language
  // or the canonical URL.
  function graph(overrides: Partial<Parameters<typeof buildSeo>[0]> = {}) {
    return siteGraph(build(overrides), settings(), SITE)
  }

  function node(type: string, overrides: Partial<Parameters<typeof buildSeo>[0]> = {}) {
    return graph(overrides)!['@graph'].find((n) => n['@type'] === type)!
  }

  it('declares the context once, for the whole graph', () => {
    expect(graph()!['@context']).toBe('https://schema.org')
    for (const entry of graph()!['@graph']) expect(entry).not.toHaveProperty('@context')
  })

  it('links the page to the site and the site to the organization', () => {
    // The point of the graph: three nodes a consumer can actually join, rather
    // than three unrelated records that happen to share a document.
    expect(node('WebSite')['@id']).toBe('https://softmess.de/#website')
    expect(node('WebSite').publisher).toEqual({'@id': 'https://softmess.de/#organization'})
    expect(node('WebPage').isPartOf).toEqual({'@id': 'https://softmess.de/#website'})
  })

  it('gives each page its own WebPage @id, derived from the canonical URL', () => {
    expect(node('WebPage', {pathname: '/impressum'})['@id']).toBe(
      'https://softmess.de/impressum#webpage',
    )
    expect(node('WebPage', {pathname: '/impressum'}).url).toBe('https://softmess.de/impressum')
  })

  it('says the home page is about the organization, and no other page does', () => {
    // The one line that tells a consumer which URL is the entity's home. It is
    // derived from the canonical URL, not from a pathname special case.
    expect(node('WebPage').about).toEqual({'@id': 'https://softmess.de/#organization'})
    expect(node('WebPage', {pathname: '/impressum'})).not.toHaveProperty('about')
  })

  it('declares the language on the page but never on the site', () => {
    // The site is mixed-language by design — a German imprint under an English
    // home page — so an inLanguage on WebSite would be a claim that is false
    // for half the routes. See docs/BACKLOG.md §4.3 on hreflang.
    expect(node('WebPage', {seo: seo({language: 'en'})}).inLanguage).toBe('en')
    expect(node('WebSite')).not.toHaveProperty('inLanguage')
  })

  it('carries the page title and description, omitting a description it lacks', () => {
    expect(node('WebPage').name).toBe('softmess project')
    expect(node('WebPage', {seo: seo({description: 'page'})}).description).toBe('page')
    expect(node('WebPage')).not.toHaveProperty('description')
  })

  it('emits nothing at all for a page that is excluded from search', () => {
    // Structured data on a noindex page is markup nobody will ever read. This
    // covers the 404, both editor switches, and the preview Worker at once.
    expect(graph({noIndex: true})).toBeNull()
  })

  it('emits nothing however the robots directive is spelled', () => {
    // The exclusion is read off meta.noIndex, not matched against the string:
    // the day robots says 'noindex, nofollow' an === comparison goes false and
    // structured data ships on a page that is excluded from search.
    const meta = {...build(), noIndex: true, robots: 'noindex, nofollow'}
    expect(siteGraph(meta, settings(), SITE)).toBeNull()
  })

  it('strips stega payloads from the title and description', () => {
    // buildSeo deliberately does not clean these — a payload is invisible in a
    // meta tag. Inside JSON-LD it is a string a validator reads, so the graph
    // has to clean what the meta tags are happy to pass through.
    const title = vercelStegaCombine('softmess project', {
      origin: 'test',
      href: '/',
      editUrl: '/edit',
    })
    const page = node('WebPage', {title, seo: seo({description: title})})
    expect(vercelStegaSplit(page.name as string).encoded).toBe('')
    expect(vercelStegaSplit(page.description as string).encoded).toBe('')
    expect(page.name).toBe('softmess project')
  })
})
