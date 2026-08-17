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

describe.skipIf(!LIVE)('the deployed preview Worker', () => {
  it('renders without a draft cookie', async () => {
    const response = await fetch(`${PREVIEW_URL}/`)
    expect(response.status, await response.text().catch(() => '')).toBe(200)
  })

  it('leaks no draft content to a request without the cookie', async () => {
    // The point of the whole draft-mode design: the preview host is reachable,
    // but without the cookie it must answer with published content only.
    const html = await (await fetch(`${PREVIEW_URL}/`)).text()
    expect(stegaCount(html)).toBe(0)
  })

  it('refuses a draft-mode handshake with no secret', async () => {
    const response = await fetch(`${PREVIEW_URL}/api/draft-mode/enable`, {redirect: 'manual'})
    expect(response.status).toBe(401)
  })

  it('sets no draft cookie on a rejected handshake', async () => {
    const response = await fetch(`${PREVIEW_URL}/api/draft-mode/enable`, {redirect: 'manual'})
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
