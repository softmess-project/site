import {readFileSync, existsSync} from 'node:fs'
import {join} from 'node:path'
import {parseHTML} from 'linkedom'
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
    expect(d.querySelector('main h2')?.textContent?.length).toBeGreaterThan(0)
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

  it('ships no JavaScript', () => {
    for (const page of PAGES) {
      expect(doc(page).querySelectorAll('script'), page).toHaveLength(0)
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

  it('gives the page exactly one h1, on the first block', () => {
    const d = doc('index.html')
    expect(d.querySelectorAll('h1')).toHaveLength(1)
    expect(d.querySelector('main > section:first-child h1')).not.toBeNull()
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
    for (const page of PAGES) {
      expect(readFileSync(join(DIST, page), 'utf8')).not.toContain('preview.softmess.de')
    }
  })
})
