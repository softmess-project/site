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

const PARSED = new Map<string, ReturnType<typeof parseHTML>['document']>()

// Memoized: several tests read a tag off every page to decide which pages they
// apply to, so the same file was being read and parsed a dozen times over. No
// test mutates the document, so one parse per page is safe to share.
function doc(page: string) {
  let parsed = PARSED.get(page)
  if (!parsed) {
    parsed = parseHTML(readFileSync(join(DIST, page), 'utf8')).document
    PARSED.set(page, parsed)
  }
  return parsed
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
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  // Static files in public/, copied verbatim into dist/. The set is what a
  // single Sanity image field could not produce: an .ico is a multi-resolution
  // container, and the manifest icons are `purpose: maskable`, which needs
  // safe-zone padding baked in rather than a square crop.
  const PNGS = {
    'favicon.png': 96,
    'apple-touch-icon.png': 180,
    'web-app-manifest-192x192.png': 192,
    'web-app-manifest-512x512.png': 512,
  }

  it('ships every PNG at the size its markup claims', () => {
    for (const [name, size] of Object.entries(PNGS)) {
      const path = join(DIST, name)
      expect(existsSync(path), name).toBe(true)
      const bytes = readFileSync(path)
      expect([...bytes.subarray(0, 8)], name).toEqual(PNG_MAGIC)
      // IHDR is the first chunk, so width/height sit at a fixed offset. A
      // mismatch means the <link sizes> or the manifest is now lying, which no
      // amount of valid PNG bytes would reveal.
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], name).toEqual([size, size])
    }
  })

  it('serves a real multi-resolution /favicon.ico at the path clients guess', () => {
    // Nothing links to it: the point is the crawlers and preview tools that
    // request /favicon.ico by convention without reading the HTML. Without the
    // file, Cloudflare's not_found_handling: "404-page" answers them with the
    // 404 HTML page — which is why a redirect used to stand in for it here.
    const bytes = readFileSync(join(DIST, 'favicon.ico'))
    expect([...bytes.subarray(0, 4)]).toEqual([0x00, 0x00, 0x01, 0x00])
    expect(bytes.readUInt16LE(4)).toBeGreaterThan(1)
  })

  it('declares a manifest whose icons all exist and are maskable', () => {
    const manifest = JSON.parse(readFileSync(join(DIST, 'site.webmanifest'), 'utf8'))
    expect(manifest.icons.length).toBeGreaterThan(0)
    for (const icon of manifest.icons) {
      // A maskable icon shown unpadded gets its edges cropped by the launcher,
      // so the purpose and the padding have to travel together.
      expect(icon.purpose, icon.src).toBe('maskable')
      expect(existsSync(join(DIST, icon.src.replace(/^\//, ''))), icon.src).toBe(true)
    }
  })

  it('links the icons and the manifest from every page', () => {
    for (const page of PAGES) {
      const d = doc(page)
      expect(d.querySelector('link[rel="icon"]')?.getAttribute('href'), page).toBe('/favicon.png')
      expect(d.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'), page).toBe(
        '/apple-touch-icon.png',
      )
      expect(d.querySelector('link[rel="manifest"]')?.getAttribute('href'), page).toBe(
        '/site.webmanifest',
      )
    }
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
    const links = [
      ...doc('index.html').querySelectorAll('main > section:first-child > div > div > a'),
    ]
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
        ...[...d.querySelectorAll('link[href]:not([rel="canonical"])')].map((n) =>
          n.getAttribute('href')!,
        ),
        ...[...d.querySelectorAll('img[src], script[src]')].map((n) => n.getAttribute('src')!),
        ...[...d.querySelectorAll('[srcset]')].flatMap((n) =>
          // Candidates are comma-space separated; a plain split(',') breaks on
          // the literal commas inside a cropped image URL's `rect=x,y,w,h`.
          n
            .getAttribute('srcset')!
            .split(/,\s+/)
            .map((s) => s.trim().split(/\s+/)[0]),
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

  // Every indexable page carries the same three-node graph, and no other page
  // carries anything. Which pages those are is read off each page's own robots
  // tag rather than listed here: the datenschutz *fixture* sets noIndex to
  // exercise that switch, while the real document does not, and this suite
  // runs against both builds.
  function indexed(page: string) {
    const robots = doc(page).querySelector('meta[name="robots"]')?.getAttribute('content') ?? ''
    return !robots.includes('noindex')
  }

  function graphOf(page: string) {
    const blocks = [...doc(page).querySelectorAll('script[type="application/ld+json"]')]
    // One block, not three siblings: the @graph is what makes the nodes join.
    expect(blocks, page).toHaveLength(1)
    // Parsing, not just presence: a malformed builder would otherwise ship
    // invisible garbage that only Google's validator ever notices.
    const json = JSON.parse(blocks[0].textContent!)
    expect(json['@context'], page).toBe('https://schema.org')
    return json['@graph'] as Record<string, unknown>[]
  }

  it('emits a parseable Organization/WebSite/WebPage graph on every indexed page', () => {
    const seen = PAGES.filter(indexed)
    // The home page is indexed in both builds; without this the suite would
    // pass vacuously if the graph ever stopped being emitted at all.
    expect(seen).toContain('index.html')

    for (const page of seen) {
      const nodes = graphOf(page)
      expect(
        nodes.map((n) => n['@type']),
        page,
      ).toEqual(['Organization', 'WebSite', 'WebPage'])

      const org = nodes[0]
      expect(org.name, page).toEqual(expect.stringMatching(/\S/))
      expect(org.url, page).toMatch(/^https:\/\//)
    }
  })

  it('resolves every @id reference within the page that makes it', () => {
    // A dangling {"@id": …} is the failure mode of a cross-page graph, and it
    // is invisible in the rendered output. Each page must be self-contained.
    for (const page of PAGES.filter(indexed)) {
      const nodes = graphOf(page)
      const defined = new Set(nodes.map((n) => n['@id']))
      const refs = nodes.flatMap((node) =>
        Object.entries(node)
          .filter(([key]) => key !== '@id')
          .map(([key, value]) => ({
            label: `${node['@type']}.${key}`,
            id: (value as {'@id'?: unknown} | null)?.['@id'],
          }))
          .filter(({id}) => typeof id === 'string'),
      )
      // publisher and isPartOf at minimum, so an empty graph cannot pass here.
      expect(refs.length, page).toBeGreaterThanOrEqual(2)
      expect(
        refs.filter(({id}) => !defined.has(id)).map(({label, id}) => `${label} → ${id}`),
        page,
      ).toEqual([])
    }
  })

  it('names the entity home on the home page only', () => {
    // `about` is the one statement that says which URL the Organization owns.
    const webPage = (page: string) => graphOf(page).find((n) => n['@type'] === 'WebPage')!
    expect(webPage('index.html').about).toBeDefined()
    for (const page of PAGES.filter((p) => p !== 'index.html' && indexed(p))) {
      expect(webPage(page).about, page).toBeUndefined()
    }
  })

  it('emits no structured data on a page excluded from search', () => {
    // Markup nobody will ever read. The 404 is noindex by route; the fixture
    // datenschutz page is noindex by the editor switch.
    const excluded = PAGES.filter((page) => !indexed(page))
    expect(excluded).toContain('404.html')
    for (const page of excluded) {
      expect(doc(page).querySelectorAll('script[type="application/ld+json"]'), page).toHaveLength(0)
    }
  })
})

describe('trailing-slash convention', () => {
  // astro.config.mjs's trailingSlash: 'never', the canonical tag, and what
  // Cloudflare's asset router actually serves must all agree — otherwise
  // every page is split across two URLs for search engines (dropTest §4).
  it('matches the canonical tag against the Workers asset router config', () => {
    const wrangler = readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8')
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

  it.skipIf(REAL_CONTENT)(
    'maps variants to classes rather than falling through to defaults',
    () => {
      // The sand-background imageText block proves the variant reached a class
      // instead of silently defaulting. The selector must be anchored to the
      // block's own <section>: a bare `.bg-sand-200` also matches a decorative
      // blob in the page chrome, which sits outside <main> and would make this
      // assertion pass in a build that has no imageText block at all.
      expect(doc('index.html').querySelector('main > section.bg-sand-200')).not.toBeNull()
    },
  )

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
    // Spelled out once as a literal, because the assertion above encodes the
    // purl the same way the generator does and would agree with it either way.
    // The version stays out of it: package.json allows ^5.3.0, so pinning the
    // resolved one would turn any `pnpm update` into a failure here that says
    // nothing about what changed.
    const purls = all.map((c: {purl: string}) => c.purl)
    expect(purls.some((purl) => purl.startsWith('pkg:npm/%40fontsource/outfit@'))).toBe(true)
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

describe('webfinger', () => {
  // The build emits every JRD the site is willing to answer for; worker.ts
  // picks one by `?resource=` and never learns what the subjects are. These
  // assertions therefore cover the half that knows the identities, and stay
  // clear of the values an editor owns — the address and the social URL are
  // Sanity fields, so only their shape is pinned, never their content.
  const docs = (): {subject: string; aliases?: string[]; links: {rel: string; href: string}[]}[] =>
    JSON.parse(readFileSync(join(DIST, '.well-known', 'webfinger'), 'utf8'))

  const bySubject = (local: string) => docs().find((d) => d.subject.startsWith(`acct:${local}@`))!

  it('publishes exactly the subjects the site claims, all at its own host', () => {
    const subjects = docs().map((d) => d.subject)
    expect(subjects).toEqual(['acct:softmess@softmess.de', 'acct:moritz@softmess.de'])
  })

  it('gives every link an absolute href', () => {
    // A relative href in a JRD is unusable: the consumer is a third party that
    // reached the document by acct: URI and has no base to resolve against.
    for (const doc of docs()) {
      expect(doc.links.length, doc.subject).toBeGreaterThan(0)
      for (const link of doc.links) expect(link.href, doc.subject).toMatch(/^[a-z]+:/)
    }
  })

  it('lets no two documents claim the same resource', () => {
    // An alias asserts "same resource". If two subjects claimed one, a query
    // for it would have two right answers and the Worker would return whichever
    // was built first — an identity decided by array order.
    const claims = docs().flatMap((d) => [d.subject, ...(d.aliases ?? [])])
    expect(new Set(claims).size).toBe(claims.length)
  })

  it('keeps the project social identity off the personal subject', () => {
    // `rel="me"` asserts sameness. The Instagram account belongs to the
    // project, so carrying it on acct:moritz would claim a person is an org.
    // Read off the org document rather than pinned, because the URL is content.
    const social = bySubject('softmess')
      .links.filter((l) => l.rel === 'me' && !l.href.startsWith('mailto:'))
      .map((l) => l.href)
    expect(social.length).toBeGreaterThan(0)
    const personal = bySubject('moritz').links.map((l) => l.href)
    for (const href of social) expect(personal).not.toContain(href)
  })

  it('offers a mailto contact on every subject', () => {
    for (const doc of docs()) {
      expect(
        doc.links.some((l) => l.href.startsWith('mailto:')),
        doc.subject,
      ).toBe(true)
    }
  })
})
