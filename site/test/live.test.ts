import {afterAll, describe, expect, it} from 'vitest'
import {createClient} from '@sanity/client'
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

// The handshake's *success* path needs a real `sanity.previewUrlSecret` in the
// dataset, which means a write token. Everything below skips without one, so
// the gate still runs for anyone who only has the hostnames.
const API_TOKEN = process.env.SANITY_API_TOKEN
const PROJECT_ID = process.env.SANITY_PROJECT_ID
const DATASET = process.env.SANITY_DATASET

// A fixed id rather than a random one, so an interrupted run leaves at most one
// stale document behind and the next run replaces it instead of accumulating.
// Sanity's own secrets are `drafts.<uuid>`, so this cannot collide with one.
const PROBE_ID = 'sanity-preview-url-secret.live-test'

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

// The link nothing tested, and the one that was actually broken. Every
// assertion above uses fetch(), which has no cookie policy at all, so the whole
// gate stayed green while Presentation could not open a preview in any browser:
// the cookie was rejected by the *browser*, not by this Worker.
//
// The Studio frames the preview from studio.softmess.de while the Worker runs on
// workers.dev, so the draft cookie is a third-party cookie. SameSite=None is
// necessary but not sufficient — without `Partitioned` it is dropped wherever
// third-party cookies are blocked, which is Safari and Chrome's Incognito by
// default. Draft mode then stays off, Base.astro renders no visual-editing
// island, and Presentation times out on "Could not connect to the preview".
//
// Attributes are asserted as a set, because getting any one of them wrong
// reproduces the same invisible failure.
describe.skipIf(!LIVE || !API_TOKEN || !PROJECT_ID || !DATASET)(
  'the deployed draft-mode handshake',
  () => {
    const client = createClient({
      projectId: PROJECT_ID!,
      dataset: DATASET!,
      apiVersion: '2026-08-15',
      useCdn: false,
      token: API_TOKEN,
    })

    // A secret this test owns, so it never depends on one the Studio happens to
    // have left behind — those expire after an hour (SECRET_TTL) and would make
    // this fail for a reason that is not the code's fault.
    const secret = `live-test-${Math.random().toString(36).slice(2)}`

    afterAll(async () => {
      await client.delete(PROBE_ID).catch(() => {})
    })

    async function handshake() {
      await client.createOrReplace({
        _id: PROBE_ID,
        _type: 'sanity.previewUrlSecret',
        secret,
        studioUrl: 'https://studio.softmess.de',
      })
      const params = new URLSearchParams({
        'sanity-preview-secret': secret,
        'sanity-preview-pathname': '/',
      })
      return get(`/api/draft-mode/enable?${params}`)
    }

    it('accepts a real secret and redirects to the requested path', async () => {
      const response = await handshake()
      expect(response.status, await response.text().catch(() => '')).toBe(307)
      expect(response.headers.get('location')).toBe('/')
    })

    it('sets a draft cookie that survives a cross-site iframe', async () => {
      const cookie = (await handshake()).headers.get('set-cookie') ?? ''

      expect(cookie).toContain('sanity-draft-mode=')
      // Sent at all from inside a frame on another site.
      expect(cookie).toMatch(/SameSite=None/i)
      // Required by the spec alongside SameSite=None, and dropped without it.
      expect(cookie).toMatch(/;\s*Secure/i)
      // CHIPS. This is the attribute whose absence broke Presentation.
      expect(cookie).toMatch(/;\s*Partitioned/i)
      // Not readable by page scripts; the overlay never needs it.
      expect(cookie).toMatch(/HttpOnly/i)
    })

    it.skipIf(!DRAFT_SECRET)('issues the secret the Worker actually accepts', async () => {
      // Closes the loop: the cookie this handshake hands out is the same value
      // that turns drafts on above, rather than merely being well-formed.
      const cookie = (await handshake()).headers.get('set-cookie') ?? ''
      expect(cookie).toContain(`sanity-draft-mode=${DRAFT_SECRET}`)
    })
  },
)

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

  it('serves the SBOM as CycloneDX, which only the deployed headers can prove', async () => {
    // public/_headers is the only thing typing this response: the path has no
    // file extension, so the asset router has nothing to infer from, and
    // whether Workers Assets applies the rule at all cannot be checked from a
    // build directory. RFC 9472 leaves the format entirely to Content-Type.
    const response = await fetch(`${SITE_URL}/.well-known/sbom`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^application\/vnd\.cyclonedx\+json/)
    expect((await response.json()).bomFormat).toBe('CycloneDX')
  })
})
