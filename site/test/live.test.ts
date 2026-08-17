import {describe, expect, it} from 'vitest'

// Assertions that can only be made against deployed hosts, so they cannot live
// in the offline `pnpm verify`. Skipped unless LIVE=1, which is what
// `pnpm verify:live` sets — the whole file is inert in the normal test run.
//
// The default run reports these as skipped rather than hiding them, so a reader
// of the test output can see the live gate exists.
const LIVE = process.env.LIVE === '1'

const PREVIEW_URL = (process.env.PREVIEW_URL ?? 'https://preview.softmess.de').replace(/\/$/, '')

// The public site sits behind Cloudflare Access, so an unauthenticated request
// is answered with a redirect to a login page rather than the site. Its checks
// only run when SITE_URL is given explicitly — from somewhere that can actually
// reach it, or against a `wrangler dev` origin.
const SITE_URL = process.env.SITE_URL?.replace(/\/$/, '')

// Whether the deployed build was made with PROXY_IMAGES=1, exactly as
// dist.test.ts gates the same pair of shapes. Production ships the flag off
// until the zone's outbound TLS problem is fixed (docs/BACKLOG.md §1.1), so
// demanding /cdn URLs unconditionally would fail this gate against a correct
// deploy — and a live gate that cries wolf is a live gate nobody reads.
const PROXIED = process.env.PROXY_IMAGES === '1'

// @vercel/stega hides its payload in Unicode tag characters (U+E0000–U+E007F),
// which is what makes click-to-edit overlays possible. A published response
// containing any of them means draft-only data reached a visitor.
const STEGA = /[\u{E0000}-\u{E007F}]/gu

function stegaCount(html: string): number {
  return html.match(STEGA)?.length ?? 0
}

// Cloudflare Access fronts the preview host, which is what makes the draft
// cookie's bare `1` safe: an anonymous request never reaches the Worker, so
// the cookie gates published-vs-draft for people already through the
// perimeter rather than gating the drafts themselves.
//
// Everything behind that perimeter therefore needs a session. Set
// PREVIEW_COOKIE to a `CF_Authorization=…` cookie — copy it from a browser
// that has logged in — to run those assertions; without it they skip and only
// the gate itself is checked.
const PREVIEW_COOKIE = process.env.PREVIEW_COOKIE

function asEditor(path: string) {
  return fetch(`${PREVIEW_URL}${path}`, {
    redirect: 'manual',
    headers: PREVIEW_COOKIE ? {cookie: PREVIEW_COOKIE} : {},
  })
}

describe.skipIf(!LIVE)('the deployed preview Worker', () => {
  it('is gated by Cloudflare Access', async () => {
    // Deliberately unauthenticated, whatever PREVIEW_COOKIE holds. This is the
    // assertion that would catch the gate being removed, which is the only
    // thing standing between the internet and every unpublished draft.
    const response = await fetch(`${PREVIEW_URL}/`, {redirect: 'manual'})
    expect(response.status, 'preview host served an anonymous request').not.toBe(200)
    expect(response.headers.get('location') ?? '').toContain('cloudflareaccess.com')
  })

  it.skipIf(!PREVIEW_COOKIE)('renders for an authenticated editor', async () => {
    const response = await asEditor('/')
    expect(response.status, await response.text().catch(() => '')).toBe(200)
  })

  it.skipIf(!PREVIEW_COOKIE)('leaks no draft content without the draft cookie', async () => {
    // Past the perimeter but without the draft cookie, the answer must still be
    // published content only.
    expect(stegaCount(await (await asEditor('/')).text())).toBe(0)
  })

  it.skipIf(!PREVIEW_COOKIE)('refuses a draft-mode handshake with no secret', async () => {
    expect((await asEditor('/api/draft-mode/enable')).status).toBe(401)
  })

  it.skipIf(!PREVIEW_COOKIE)('sets no draft cookie on a rejected handshake', async () => {
    const response = await asEditor('/api/draft-mode/enable')
    expect(response.headers.get('set-cookie') ?? '').not.toContain('sanity-draft-mode')
  })
})

describe.skipIf(!LIVE || !SITE_URL)('the deployed public site', () => {
  it('names no third-party origin in its HTML', async () => {
    const html = await (await fetch(`${SITE_URL}/`)).text()
    // cdn.sanity.io is the one third-party origin the unproxied build is
    // allowed to name, and with the flag off it is expected to.
    if (PROXIED) expect(html).not.toContain('cdn.sanity.io')
    expect(html).not.toContain('preview.softmess.de')
  })

  it('ships no stega markers', async () => {
    const html = await (await fetch(`${SITE_URL}/`)).text()
    expect(stegaCount(html)).toBe(0)
  })

  it.skipIf(!PROXIED)('serves images through its own /cdn proxy', async () => {
    // Takes the first proxied image URL out of the page rather than hard-coding
    // an asset id, so replacing the hero in the Studio cannot break this.
    const html = await (await fetch(`${SITE_URL}/`)).text()
    const match = html.match(/src="(\/cdn\/images\/[^"]+)"/)
    expect(match, 'no /cdn/images/ URL in the page').not.toBeNull()

    const src = match![1].replaceAll('&amp;', '&')
    const image = await fetch(`${SITE_URL}${src}`)
    expect(image.status, src).toBe(200)
    expect(image.headers.get('content-type')).toMatch(/^image\//)
  })

  it('does not let the /cdn proxy reach another project', async () => {
    const response = await fetch(`${SITE_URL}/cdn/images/someoneelse/production/x-1x1.jpg`)
    expect(response.status).toBe(404)
  })
})
