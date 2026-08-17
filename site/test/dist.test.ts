import {readFileSync, existsSync} from 'node:fs'
import {join} from 'node:path'
import {parseHTML} from 'linkedom'
import {beforeAll, describe, expect, it} from 'vitest'

// Defaults to the fixture build for the offline/no-secrets path. CI re-runs
// this same suite with DIST_DIR=dist against the real Sanity build before
// deploying — that run is what catches unfilled placeholder content.
const DIST = join(import.meta.dirname, '..', process.env.DIST_DIR ?? 'dist-fixtures')
const PAGES = ['index.html', 'impressum/index.html', 'datenschutz/index.html', '404.html']

function doc(page: string) {
  return parseHTML(readFileSync(join(DIST, page), 'utf8')).document
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
  it('renders the hero copy', () => {
    const text = doc('index.html').body.textContent ?? ''
    expect(text).toContain('softmess')
    expect(text).toContain('follow the white rabbit.')
    expect(text).toContain('refuse to sit still')
  })

  it('renders the hero image as a responsive Sanity CDN image', () => {
    const img = doc('index.html').querySelector('main img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toContain('cdn.sanity.io')
    expect(img!.getAttribute('srcset')).toContain('2x')
    expect(img!.getAttribute('alt')?.length).toBeGreaterThan(0)
  })

  it('renders one button per action, first one filled', () => {
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
    expect(d.querySelector('a[href="mailto:hi@softmess.de"]')).not.toBeNull()
  })

  it('renders the page content', () => {
    expect(doc('datenschutz/index.html').body.textContent).toContain('Datenschutzerklärung')
  })
})

describe('promises the site makes in its own privacy policy', () => {
  it('ships no unfilled placeholder text', () => {
    for (const page of PAGES) {
      const text = doc(page).body.textContent ?? ''
      const placeholders = text.match(/\[[a-z][^\]]{2,}\]/g) ?? []
      expect(placeholders, `${page} still contains ${placeholders.join(', ')}`).toEqual([])
    }
  })

  it('loads no third-party subresource', () => {
    const allowed = /^(\/|\.|data:|#)|cdn\.sanity\.io/
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

describe('footer navigation', () => {
  it('derives the footer nav from Sanity, not from hardcoded routes', () => {
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
  it('renders every block type', () => {
    const d = doc('index.html')
    expect(d.querySelectorAll('main > section')).toHaveLength(5)
  })

  it('renders blocks in array order', () => {
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

  it('maps variants to classes rather than falling through to defaults', () => {
    // The sand-background imageText block in the fixtures proves the variant
    // reached a class instead of silently defaulting.
    expect(doc('index.html').querySelector('.bg-sand-200')).not.toBeNull()
  })

  it('keeps the preview hostname out of the static build', () => {
    for (const page of PAGES) {
      expect(readFileSync(join(DIST, page), 'utf8')).not.toContain('preview.softmess.de')
    }
  })
})
