import {readFileSync, existsSync} from 'node:fs'
import {join} from 'node:path'
import {parseHTML} from 'linkedom'
import {Spec, Validation} from '@cyclonedx/cyclonedx-library'
import {beforeAll, describe, expect, it} from 'vitest'

// Defaults to the fixture build for the offline/no-secrets path. CI re-runs
// this same suite with DIST_DIR=dist against the real Sanity build before
// deploying — that run is what catches unfilled placeholder content.
const DIST = join(import.meta.dirname, '..', process.env.DIST_DIR ?? 'dist-fixtures')
const PAGES = ['index.html', 'impressum/index.html', 'datenschutz/index.html', '404.html']

// The fixtures model every block type, in a fixed order, in English, so the
// rendering pipeline is provably exercised end to end.
//
// Every assertion about *what the content says* — exact copy, block counts,
// how many action buttons, which nav labels, whether a placeholder is still
// unfilled — is fixture-only. Real content is German, is edited in the Studio
// without touching this repo, and has exactly as many blocks as the owner has
// actually placed; pinning it here turns ordinary editing into a broken build.
// The deploy build therefore checks structure and safety only: routes exist,
// pages have metadata, the hero heading is non-empty, images come from Sanity's
// CDN, no third-party subresource, no JavaScript, canonical and trailing-slash
// agree, and the preview hostname never leaks.
const REAL_CONTENT = process.env.DIST_DIR === 'dist'

// Whether the build under test rewrote images onto our own origin. Must match
// the flag the build ran with — see astro.config.mjs. Both shapes are asserted
// rather than one, because the flag is off in production until the zone's
// outbound TLS problem is fixed (docs/BACKLOG.md §1.1) and the shipping shape is
// the one that most needs a test.
const PROXIED = process.env.PROXY_IMAGES === '1'

function doc(page: string) {
  return parseHTML(readFileSync(join(DIST, page), 'utf8')).document
}

// Catches both the original `[bracketed]` placeholder convention and the
// literal "TBD" / "TODO" the imprint's address fields carry today — a
// standalone word, not a substring, so e.g. "Datenschutzerklärung" is safe.
function findPlaceholders(text: string): string[] {
  // Case-insensitive so a capitalized placeholder like "[Straße]" is caught,
  // not just the lowercase "[street and number]" convention.
  const bracketed = text.match(/\[[a-z][^\]]{2,}\]/gi) ?? []
  const words = text.match(/\b(TBD|TODO)\b/gi) ?? []
  return [...bracketed, ...words]
}

beforeAll(() => {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`Run a build that outputs to ${DIST} before the dist tests`)
  }
})

describe('built pages', () => {
  it('emits every route', () => {
    for (const page of PAGES) expect(existsSync(join(DIST, page)), page).toBe(true)
  })

  it('gives each page a title and a description', () => {
    for (const page of ['index.html', 'impressum/index.html', 'datenschutz/index.html']) {
      const d = doc(page)
      expect(d.title.length, page).toBeGreaterThan(0)
      expect(d.querySelector('meta[name="description"]'), page).not.toBeNull()
    }
  })

  it.skipIf(REAL_CONTENT)('emits an absolute og:image, inheriting the site-wide default', () => {
    // og:image is the one tag a relative URL breaks silently: scrapers drop it
    // and nothing on the page looks wrong. The fixture sets the image on
    // siteSettings only, so this also pins the fall-through from a page that
    // has no image of its own.
    for (const page of ['index.html', 'impressum/index.html']) {
      const d = doc(page)
      const content = d.querySelector('meta[property="og:image"]')?.getAttribute('content')
      expect(content, page).toBeTruthy()
      expect(new URL(content!).protocol, page).toBe('https:')
      expect(content, page).toContain('w=1200')
      expect(d.querySelector('meta[name="twitter:card"]')?.getAttribute('content'), page).toBe(
        'summary_large_image',
      )
    }
  })

  it('emits the Open Graph tags every scraper reads', () => {
    for (const page of ['index.html', 'impressum/index.html', 'datenschutz/index.html']) {
      const d = doc(page)
      const prop = (name: string) =>
        d.querySelector(`meta[property="${name}"]`)?.getAttribute('content')
      expect(prop('og:url'), page).toBe(
        d.querySelector('link[rel="canonical"]')?.getAttribute('href'),
      )
      expect(prop('og:site_name'), page).toBeTruthy()
      expect(prop('og:locale'), page).toMatch(/^(en_US|de_DE)$/)
      expect(prop('og:type'), page).toBe('website')
    }
  })

  it.skipIf(REAL_CONTENT)('declares the social image as a JPEG of known size', () => {
    // The box is requested, so width/height/type are facts rather than hints —
    // and a WebP og:image renders as no image at all on LinkedIn and Facebook.
    for (const page of ['index.html', 'impressum/index.html']) {
      const d = doc(page)
      const prop = (name: string) =>
        d.querySelector(`meta[property="${name}"]`)?.getAttribute('content')
      expect(prop('og:image'), page).toContain('fm=jpg')
      expect(prop('og:image'), page).not.toContain('fm=webp')
      expect(prop('og:image:width'), page).toBe('1200')
      expect(prop('og:image:height'), page).toBe('630')
      expect(prop('og:image:type'), page).toBe('image/jpeg')
    }
  })

  it.skipIf(REAL_CONTENT)(
    'resolves each page language from its own setting, or the code default when unset',
    () => {
      // The fixtures set 'en' on the home page, 'de' on the imprint, and
      // nothing at all on datenschutz or siteSettings — so the third case
      // proves the code default rather than a stored value. Site-level
      // fall-through (a page with nothing set inheriting siteSettings'
      // language) is covered only by the unit test in seo.test.ts, not here.
      expect(doc('index.html').documentElement.getAttribute('lang')).toBe('en')
      expect(doc('impressum/index.html').documentElement.getAttribute('lang')).toBe('de')
      expect(doc('datenschutz/index.html').documentElement.getAttribute('lang')).toBe('de')
    },
  )

  it('asks for a large image preview where indexed, and excludes where not', () => {
    const robots = (page: string) =>
      doc(page).querySelector('meta[name="robots"]')?.getAttribute('content')
    // *Which* content pages are indexed is an editor switch — seo.noIndex, per
    // page and site-wide — so the deploy run asserts the shape only: every page
    // carries one of the two values the code can emit, and neither is missing.
    // Pinning the imprint as indexed here failed the deploy the day it was
    // excluded in the Studio. The fixture run still pins which page gets which,
    // below and in the sitemap test.
    for (const page of PAGES) {
      expect(robots(page), page).toMatch(/^(max-image-preview:large|noindex)$/)
    }
    // The 404 excludes itself regardless of content.
    expect(robots('404.html')).toBe('noindex')
  })

  it.skipIf(REAL_CONTENT)('honours the per-page exclusion switch', () => {
    // The fixture sets noIndex on datenschutz only.
    expect(
      doc('datenschutz/index.html').querySelector('meta[name="robots"]')?.getAttribute('content'),
    ).toBe('noindex')
  })
})

describe('site icon', () => {
  // Prerendered from Sanity at build time, exactly like robots.txt and
  // sitemap.xml, so a visitor fetches the icon from our own origin and never
  // contacts Sanity for it. That matters most on the legal pages and the 404,
  // which load no images at all.
  const ICONS = ['favicon.png', 'apple-touch-icon.png']

  it('emits both icon files as real PNGs, whether or not one was uploaded', () => {
    // Unconditional on purpose, real content included. The routes never 404:
    // a prerendered endpoint writes its body to dist/ whatever the status and
    // Cloudflare serves that file with 200, so "no icon yet" has to mean valid
    // placeholder bytes rather than an empty file answering 200.
    for (const icon of ICONS) {
      const path = join(DIST, icon)
      expect(existsSync(path), icon).toBe(true)
      const magic = [...readFileSync(path).subarray(0, 8)]
      expect(magic, icon).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    }
  })

  it('links both from every page', () => {
    for (const page of PAGES) {
      const d = doc(page)
      expect(d.querySelector('link[rel="icon"]')?.getAttribute('href'), page).toBe('/favicon.png')
      expect(d.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'), page).toBe(
        '/apple-touch-icon.png',
      )
    }
  })

  it('redirects the legacy /favicon.ico that crawlers still request', () => {
    // Browsers honouring <link rel="icon"> never ask for it, but crawlers and
    // preview tools do, and without the rule Cloudflare's
    // not_found_handling: "404-page" answers them with the 404 HTML page.
    const redirects = readFileSync(join(import.meta.dirname, '..', 'public', '_redirects'), 'utf8')
    expect(redirects).toContain('/favicon.ico /favicon.png 301')
  })
})

describe('home page', () => {
  // Split deliberately: the exact copy is fixture-only, but "the hero says
  // something at all" must hold for the real build too — otherwise a hero
  // with an empty heading ships past every remaining assertion here.
  it('renders a non-empty hero heading', () => {
    const h1 = doc('index.html').querySelector('main > section:first-child h1')
    expect(h1?.textContent?.trim().length).toBeGreaterThan(0)
  })

  it.skipIf(REAL_CONTENT)('renders the hero copy', () => {
    const text = doc('index.html').body.textContent ?? ''
    expect(text).toContain('softmess')
    expect(text).toContain('follow the white rabbit.')
    expect(text).toContain('refuse to sit still')
  })

  it('renders the hero image as a responsive image from the expected origin', () => {
    const img = doc('index.html').querySelector('main img')
    expect(img).not.toBeNull()
    // Proxied: same-origin `/cdn/...`, still carrying Sanity's own
    // project/dataset/asset layout, which is what src/worker.ts pins against.
    // Unproxied: straight at Sanity's CDN.
    expect(img!.getAttribute('src')).toMatch(
      PROXIED ? /^\/cdn\/images\/85i3osnk\/production\// : /^https:\/\/cdn\.sanity\.io\/images\//,
    )
    expect(img!.getAttribute('srcset')).toContain('2x')
    expect(img!.getAttribute('alt')?.length).toBeGreaterThan(0)
  })

  it.skipIf(REAL_CONTENT)('renders one button per action, first one filled', () => {
    const links = [...doc('index.html').querySelectorAll('main > section:first-child > div > div > a')]
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute('class')).toContain('bg-accent')
    expect(links[1].getAttribute('href')).toBe('mailto:hi@softmess.de')
  })
})

describe('content pages', () => {
  it('renders portable text headings, paragraphs and mailto links', () => {
    const d = doc('impressum/index.html')
    // Either level: the first heading of a page-opening richText block is
    // promoted to the page's h1, so pinning h2 here would pin the position of
    // the block rather than that headings render at all.
    expect(d.querySelector('main h1, main h2')?.textContent?.length).toBeGreaterThan(0)
    expect(d.querySelector('main p')).not.toBeNull()
    // Any mailto, not a specific address — this checks that Portable Text
    // renders link marks at all, which is structure; which address the imprint
    // carries is content and may change in the Studio.
    expect(d.querySelector('main a[href^="mailto:"]')).not.toBeNull()
  })

  it.skipIf(REAL_CONTENT)('renders the page content', () => {
    expect(doc('datenschutz/index.html').body.textContent).toContain('Datenschutzerklärung')
  })
})

describe('placeholder detection', () => {
  // Proves the guard below actually fires against what the imprint says
  // today ("Softmess Project (TBD)", "TBD, § 18 (2) MStV.") — not just
  // against the old `[bracketed]` convention it was written for.
  it('flags a standalone TBD, case-insensitively, without flagging real words', () => {
    expect(findPlaceholders('Softmess Project (TBD)')).toEqual(['TBD'])
    expect(findPlaceholders('TBD, § 18 (2) MStV.')).toEqual(['TBD'])
    expect(findPlaceholders('still a todo')).toEqual(['todo'])
    expect(findPlaceholders('Datenschutzerklärung')).toEqual([])
  })

  it('flags a capitalized bracket placeholder too, e.g. "[Straße]"', () => {
    expect(findPlaceholders('wohnhaft in [Straße]')).toEqual(['[Straße]'])
  })
})

describe('promises the site makes in its own privacy policy', () => {
  it.skipIf(REAL_CONTENT)('ships no unfilled placeholder text', () => {
    for (const page of PAGES) {
      const text = doc(page).body.textContent ?? ''
      const placeholders = findPlaceholders(text)
      expect(placeholders, `${page} still contains ${placeholders.join(', ')}`).toEqual([])
    }
  })

  it('loads no third-party subresource', () => {
    // With the proxy on, relative and same-origin only — the built HTML names no
    // external host at all, which is the whole point of src/worker.ts. With it
    // off, cdn.sanity.io is the one permitted exception, and the privacy policy
    // has to keep disclosing it.
    const allowed = PROXIED ? /^(\/|\.|data:|#)/ : /^(\/|\.|data:|#)|cdn\.sanity\.io/
    for (const page of PAGES) {
      const d = doc(page)
      const refs = [
        // rel=canonical is an absolute self-reference, not a fetched
        // subresource — it points at https://softmess.de by design.
        ...[...d.querySelectorAll('link[href]:not([rel="canonical"])')].map(
          (n) => n.getAttribute('href')!,
        ),
        ...[...d.querySelectorAll('img[src], script[src]')].map(
          (n) => n.getAttribute('src')!,
        ),
        ...[...d.querySelectorAll('[srcset]')].flatMap((n) =>
          // Candidates are comma-space separated; a plain split(',') breaks on
          // the literal commas inside a cropped image URL's `rect=x,y,w,h`.
          n.getAttribute('srcset')!.split(/,\s+/).map((s) => s.trim().split(/\s+/)[0]),
        ),
      ]
      for (const ref of refs) {
        expect(allowed.test(ref), `${page} loads ${ref}`).toBe(true)
      }
    }
  })

  it('ships no executable JavaScript', () => {
    // Narrower than "no <script> elements", not weaker: JSON-LD is a script
    // tag that cannot run, and these two conditions together admit nothing
    // that can. A src would be a third-party subresource (the test above
    // catches that too); any type other than ld+json would be code.
    for (const page of PAGES) {
      const scripts = [...doc(page).querySelectorAll('script')]
      for (const script of scripts) {
        expect(script.getAttribute('src'), `${page} loads a script`).toBeNull()
        expect(script.getAttribute('type'), `${page} runs a script`).toBe('application/ld+json')
      }
    }
  })

  it('emits parseable Organization JSON-LD on the home page only', () => {
    const blocks = [...doc('index.html').querySelectorAll('script[type="application/ld+json"]')]
    expect(blocks).toHaveLength(1)
    // Parsing, not just presence: a malformed builder would otherwise ship
    // invisible garbage that only Google's validator ever notices.
    const json = JSON.parse(blocks[0].textContent!)
    expect(json['@context']).toBe('https://schema.org')
    expect(json['@type']).toBe('Organization')
    expect(json.name.length).toBeGreaterThan(0)
    expect(json.url).toMatch(/^https:\/\//)

    // A knowledge-panel signal belongs on the home page and nowhere else.
    for (const page of ['impressum/index.html', 'datenschutz/index.html', '404.html']) {
      expect(doc(page).querySelectorAll('script[type="application/ld+json"]'), page).toHaveLength(0)
    }
  })
})

describe('trailing-slash convention', () => {
  // astro.config.mjs's trailingSlash: 'never', the canonical tag, and what
  // Cloudflare's asset router actually serves must all agree — otherwise
  // every page is split across two URLs for search engines (dropTest §4).
  it('matches the canonical tag against the Workers asset router config', () => {
    const wrangler = readFileSync(
      join(import.meta.dirname, '..', 'wrangler.jsonc'),
      'utf8',
    )
    // wrangler.jsonc is JSONC (comments allowed) — strip line comments before parsing.
    const json = JSON.parse(wrangler.replace(/\/\/.*$/gm, ''))
    expect(json.assets.html_handling).toBe('drop-trailing-slash')
  })

  it('emits non-root canonical URLs with no trailing slash', () => {
    for (const page of ['impressum/index.html', 'datenschutz/index.html']) {
      const href = doc(page).querySelector('link[rel="canonical"]')?.getAttribute('href')
      expect(href, page).not.toMatch(/.+\/$/)
    }
  })
})

describe('footer navigation', () => {
  it.skipIf(REAL_CONTENT)('derives the footer nav from Sanity, not from hardcoded routes', () => {
    const nav = [...doc('index.html').querySelectorAll('footer nav a')]
    expect(nav.map((a) => a.getAttribute('href'))).toEqual([
      '/impressum',
      '/datenschutz',
      'https://www.instagram.com/softmess.project/',
    ])
    expect(nav.map((a) => a.textContent?.trim())).toEqual(['Impressum', 'Datenschutz', 'instagram'])
  })
})

describe('page builder', () => {
  it.skipIf(REAL_CONTENT)('renders every block type', () => {
    const d = doc('index.html')
    expect(d.querySelectorAll('main > section')).toHaveLength(5)
  })

  it.skipIf(REAL_CONTENT)('renders blocks in array order', () => {
    // The fixture's block order is hero, richText, imageText, gallery, cta.
    // Rendering out of order would be invisible to every other assertion here.
    const sections = [...doc('index.html').querySelectorAll('main > section')]
    expect(sections[0].querySelector('h1')).not.toBeNull()
    expect(sections[3].querySelectorAll('img').length).toBeGreaterThan(1)
  })

  it('gives every page exactly one h1, on the first block', () => {
    // Every content page, not just the home page: the legal pages open with a
    // richText block, and when only Hero/ImageText/Cta honoured semanticLevel
    // that block silently consumed the h1 slot and emitted nothing, leaving
    // those pages with no h1 at all while this assertion still passed.
    for (const page of PAGES.filter((p) => p !== '404.html')) {
      const d = doc(page)
      expect(d.querySelectorAll('h1'), page).toHaveLength(1)
      expect(d.querySelector('main > section:first-child h1'), page).not.toBeNull()
    }
  })

  it.skipIf(REAL_CONTENT)('maps variants to classes rather than falling through to defaults', () => {
    // The sand-background imageText block proves the variant reached a class
    // instead of silently defaulting. The selector must be anchored to the
    // block's own <section>: a bare `.bg-sand-200` also matches a decorative
    // blob in the page chrome, which sits outside <main> and would make this
    // assertion pass in a build that has no imageText block at all.
    expect(doc('index.html').querySelector('main > section.bg-sand-200')).not.toBeNull()
  })

  it('keeps the preview hostname out of the static build', () => {
    // PAGES stays HTML-only — it feeds doc() and the placeholder scan — so the
    // two crawler files are added at this one call site. sitemap.xml is where a
    // leaked origin does the most damage: every URL in it would be wrong.
    for (const page of [...PAGES, 'robots.txt', 'sitemap.xml']) {
      expect(readFileSync(join(DIST, page), 'utf8')).not.toContain(
        'softmess-preview.9dev.workers.dev',
      )
    }
  })
})

describe('crawler directives', () => {
  // doc() rather than a regex over the raw file: a hand-rolled `<loc>` pattern
  // silently returns [] if the emitted XML ever gains an attribute or a
  // newline, and an empty list reads as "no URLs" instead of failing.
  function locs(): string[] {
    return [...doc('sitemap.xml').querySelectorAll('loc')].map((n) => n.textContent!)
  }

  it('allows crawling and points at the sitemap', () => {
    const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8')
    expect(robots).toContain('User-agent: *')
    expect(robots).toContain('Allow: /')
    // The site-wide switch on siteSettings would put this here instead, which
    // is exactly the accident worth catching: a Disallow in the production
    // build is indistinguishable from a working one until traffic disappears.
    expect(robots).not.toContain('Disallow')
    // Same origin the canonical tags use, or search engines treat the sitemap
    // as cross-submitted and ignore it.
    expect(robots).toContain('Sitemap: https://softmess.de/sitemap.xml')
  })

  it('lists absolute URLs on the production origin, agreeing with trailingSlash', () => {
    const urls = locs()
    expect(urls).toContain('https://softmess.de/')
    for (const loc of urls) {
      expect(loc, loc).toMatch(/^https:\/\/softmess\.de\//)
      if (new URL(loc).pathname !== '/') expect(loc, loc).not.toMatch(/\/$/)
    }
  })

  it.skipIf(REAL_CONTENT)('excludes a noIndex page from the sitemap and marks it noindex', () => {
    // The fixture sets seo.noIndex on datenschutz only. Both halves matter:
    // dropping it from the sitemap is the hint, the meta tag is the directive,
    // and only the tag actually keeps the page out of search results.
    expect(locs()).toEqual(['https://softmess.de/', 'https://softmess.de/impressum'])
    const excluded = doc('datenschutz/index.html').querySelector('meta[name="robots"]')
    expect(excluded?.getAttribute('content')).toBe('noindex')
    for (const page of ['index.html', 'impressum/index.html']) {
      expect(doc(page).querySelector('meta[name="robots"]')?.getAttribute('content'), page).toBe(
        'max-image-preview:large',
      )
    }
  })
})

describe('software bill of materials', () => {
  // /.well-known/sbom is the URI RFC 9472 registers. That RFC defines discovery
  // only and says nothing about the format, so conformance here is CycloneDX's
  // — asserted against CycloneDX's own published schema rather than against
  // this suite's idea of it.
  const bom = () => readFileSync(join(DIST, '.well-known', 'sbom'), 'utf8')

  it('validates against the official CycloneDX 1.6 schema', async () => {
    // The one assertion that is not a restatement of the generator. It is what
    // caught `web-app` as a component type: it reads like the obvious value and
    // is not in the classification enum.
    const validator = new Validation.JsonStrictValidator(Spec.Version.v1dot6)
    expect(await validator.validate(bom())).toBeNull()
  })

  it('describes the site itself, stamped with the build time', () => {
    const {metadata, specVersion} = JSON.parse(bom())
    // Pinned to the schema the test above validates against, so the two cannot
    // drift into validating 1.6 rules against a document claiming another.
    expect(specVersion).toBe(Spec.Version.v1dot6)
    expect(metadata.component.name).toBe('softmess.de')
    expect(new Date(metadata.timestamp).getTime()).not.toBeNaN()
  })

  it('gives every component a resolved version and a matching purl', () => {
    const doc = JSON.parse(bom())
    const all = [...doc.components, ...doc.metadata.tools.components]
    expect(all.length).toBeGreaterThan(0)
    for (const c of all) {
      // A range like ^5.3.0 is a fact about package.json, not about the build.
      expect(c.version, c.name).toMatch(/^\d+\.\d+\.\d+/)
      expect(c.purl, c.name).toBe(`pkg:npm/${c.name.replace('@', '%40')}@${c.version}`)
    }
    // Pinned once as a literal, because the assertion above encodes the purl
    // the same way the generator does and would agree with it either way.
    expect(all.map((c: {purl: string}) => c.purl)).toContain('pkg:npm/%40fontsource/outfit@5.3.0')
  })

  it('claims exactly the font packages the layout imports', () => {
    // The direction that matters. A hand-kept list fails by omission: someone
    // adds a font to Base.astro, several hundred more files go to visitors, and
    // an unchanged SBOM keeps saying the site contains two — a false statement
    // on a public transparency URL, with a green suite. Comparing the whole set
    // against the imports catches that and the stale-entry case both.
    const layout = readFileSync(join(import.meta.dirname, '..', 'src/layouts/Base.astro'), 'utf8')
    const imported = new Set([...layout.matchAll(/@fontsource\/[a-z0-9-]+/g)].map((m) => m[0]))
    expect(imported.size).toBeGreaterThan(0)
    expect(new Set(JSON.parse(bom()).components.map((c: {name: string}) => c.name))).toEqual(
      imported,
    )
  })

  it('declares the CycloneDX media type, which the extensionless path cannot', () => {
    // Workers Assets types a response by file extension and there is none, so
    // without this rule the SBOM is served as an unknown type and no consumer
    // can tell which format it got — the one thing RFC 9472 does require the
    // server to signal. Read from the build, not from public/, so it also
    // proves the rule reached the artifact.
    const headers = readFileSync(join(DIST, '_headers'), 'utf8')
    expect(headers).toContain('/.well-known/sbom')
    expect(headers).toContain('Content-Type: application/vnd.cyclonedx+json')
  })
})
