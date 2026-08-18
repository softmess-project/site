import {describe, expect, it} from 'vitest'
import {vercelStegaCleanAll} from '@sanity/client/stega'

// Assertions that can only be made against deployed hosts, so they cannot live
// in the offline `pnpm verify`. Skipped unless LIVE=1, which is what
// `pnpm verify:live` sets — the whole file is inert in the normal test run.
//
// The default run reports these as skipped rather than hiding them, so a reader
// of the test output can see the live gate exists.
const LIVE = process.env.LIVE === '1'

const PREVIEW_URL = (
  process.env.PREVIEW_URL ?? 'https://softmess-preview.9dev.workers.dev'
).replace(/\/$/, '')

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

// Stega hides its payload in the string content itself, and the encoding the
// library uses is its own business — it is currently a run of zero-width
// characters (U+200B/200C/200D/FEFF), and it used to be Unicode tag characters
// (U+E0000–U+E007F). This file hard-coded the tag range, so once the library
// moved every assertion below silently passed on any input, leak or not.
// Asking the library to strip its own markers keeps the detector correct
// across that change and the next one: whatever it removes was stega.
function stegaCount(html: string): number {
  return html.length - vercelStegaCleanAll(html).length
}

// The preview Worker runs on workers.dev, where Cloudflare Access cannot reach
// it — Access applications bind to hostnames in a zone you control. Nothing
// fronts this Worker, so the draft-mode cookie is the whole gate, and it
// carries PREVIEW_DRAFT_SECRET rather than a guessable `1` (src/lib/draft.ts).
//
// These assertions therefore need no session. Set PREVIEW_DRAFT_SECRET to the
// deployed Worker's secret to additionally prove the positive case — that a
// correct cookie really does turn drafts on — which otherwise skips.
const DRAFT_SECRET = process.env.PREVIEW_DRAFT_SECRET

function get(path: string, cookie?: string) {
  return fetch(`${PREVIEW_URL}${path}`, {
    redirect: 'manual',
    headers: cookie ? {cookie} : {},
  })
}

describe.skipIf(!LIVE)('the deployed preview Worker', () => {
  it('renders, which is what the zone could not do', async () => {
    // A Worker on the softmess.de zone answered 500 here, because every
    // api.sanity.io subrequest came back 525. This asserts the move off the
    // zone actually fixed that, not just that the Worker deployed.
    const response = await get('/')
    expect(response.status, await response.text().catch(() => '')).toBe(200)
  })

  it('serves published content to an anonymous visitor', async () => {
    expect(stegaCount(await (await get('/')).text())).toBe(0)
  })

  // The regression that matters most. Before the cookie carried a secret, this
  // exact request returned every unpublished draft, and only Cloudflare Access
  // stood in front of it. On workers.dev there is no perimeter, so if this ever
  // starts passing draft content the drafts are simply public.
  it('refuses a forged draft cookie', async () => {
    const response = await get('/', 'sanity-draft-mode=1')
    expect(response.status).toBe(200)
    expect(stegaCount(await response.text()), 'forged cookie returned draft content').toBe(0)
  })

  it('refuses a draft cookie holding a wrong secret', async () => {
    const response = await get('/', 'sanity-draft-mode=not-the-secret')
    expect(stegaCount(await response.text())).toBe(0)
  })

  it('refuses a draft-mode handshake with no secret', async () => {
    expect((await get('/api/draft-mode/enable')).status).toBe(401)
  })

  it('sets no draft cookie on a rejected handshake', async () => {
    const response = await get('/api/draft-mode/enable')
    expect(response.headers.get('set-cookie') ?? '').not.toContain('sanity-draft-mode')
  })

  it.skipIf(!DRAFT_SECRET)('renders drafts for the real secret', async () => {
    // The counterpart to the forged-cookie case: proves the gate is a gate and
    // not simply broken shut, which would pass every assertion above.
    const html = await (await get('/', `sanity-draft-mode=${DRAFT_SECRET}`)).text()
    expect(stegaCount(html), 'the correct cookie did not enable draft mode').toBeGreaterThan(0)
  })

  it('exposes no diagnostics route', async () => {
    expect((await get('/api/diag')).status).toBe(404)
  })
})

describe.skipIf(!LIVE || !SITE_URL)('the deployed public site', () => {
  it('names no third-party origin in its HTML', async () => {
    const html = await (await fetch(`${SITE_URL}/`)).text()
    // cdn.sanity.io is the one third-party origin the unproxied build is
    // allowed to name, and with the flag off it is expected to.
    if (PROXIED) expect(html).not.toContain('cdn.sanity.io')
    expect(html).not.toContain('softmess-preview.9dev.workers.dev')
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
