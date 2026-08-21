import {describe, expect, it} from 'vitest'
import {upstreamFor, webfinger} from '../src/worker'

const env = {
  ASSETS: {fetch: async () => new Response(null)},
  SANITY_PROJECT_ID: '85i3osnk',
  SANITY_DATASET: 'production',
}

const ASSET = 'a4762a66ff4e0a56d80ae17a10742c2c7a67940f-966x1207.jpg'

describe('the /cdn image proxy', () => {
  it('maps an image path to its Sanity URL', () => {
    expect(upstreamFor(`/cdn/images/85i3osnk/production/${ASSET}`, env)).toBe(
      `https://cdn.sanity.io/images/85i3osnk/production/${ASSET}`,
    )
  })

  it('maps a file path too', () => {
    expect(upstreamFor('/cdn/files/85i3osnk/production/abc123.pdf', env)).toBe(
      'https://cdn.sanity.io/files/85i3osnk/production/abc123.pdf',
    )
  })

  it('ignores paths it does not own, so the asset router keeps serving them', () => {
    expect(upstreamFor('/', env)).toBeNull()
    expect(upstreamFor('/impressum', env)).toBeNull()
    expect(upstreamFor('/_astro/Base.BLUQ19LV.css', env)).toBeNull()
  })

  // The reason the route is pinned rather than a generic pass-through: without
  // these checks, /cdn/* would be an open proxy anyone could point at any
  // Sanity project — or, with a traversal, at another host entirely.
  describe('refuses to act as an open proxy', () => {
    it('rejects another project or dataset', () => {
      expect(upstreamFor(`/cdn/images/someoneelse/production/${ASSET}`, env)).toBeNull()
      expect(upstreamFor(`/cdn/images/85i3osnk/staging/${ASSET}`, env)).toBeNull()
    })

    it('rejects a kind that is not images or files', () => {
      expect(upstreamFor('/cdn/data/85i3osnk/production/query', env)).toBeNull()
      expect(upstreamFor(`/cdn/85i3osnk/production/${ASSET}`, env)).toBeNull()
    })

    it('rejects anything but a single asset segment', () => {
      expect(upstreamFor('/cdn/images/85i3osnk/production/', env)).toBeNull()
      expect(upstreamFor('/cdn/images/85i3osnk/production', env)).toBeNull()
      expect(upstreamFor(`/cdn/images/85i3osnk/production/deeper/${ASSET}`, env)).toBeNull()
    })

    it('cannot be walked out of with a traversal segment', () => {
      // new URL() would resolve `..` against the CDN origin, so the guard has
      // to reject the extra segments before a URL is ever constructed.
      expect(upstreamFor('/cdn/images/85i3osnk/production/../../../etc/passwd', env)).toBeNull()
      expect(upstreamFor('/cdn/../data/query/production', env)).toBeNull()
    })
  })
})

// A pair of documents shaped like the ones the endpoint builds: one with an
// alias and a full link set, one lean. Kept small on purpose — these tests are
// about RFC 7033's request semantics, not about what the site says.
const INDEX = [
  {
    subject: 'acct:softmess@softmess.de',
    aliases: ['https://softmess.de/'],
    links: [
      {
        rel: 'http://webfinger.net/rel/profile-page',
        type: 'text/html',
        href: 'https://softmess.de/',
      },
      {rel: 'me', href: 'https://www.instagram.com/softmess.project/'},
    ],
  },
  {
    subject: 'acct:moritz@softmess.de',
    links: [{rel: 'me', href: 'mailto:hi@softmess.de'}],
  },
]

const jrdEnv = {
  ...env,
  ASSETS: {fetch: async () => new Response(JSON.stringify(INDEX))},
}

const ask = (query: string, method = 'GET') =>
  webfinger(new Request(`https://softmess.de/.well-known/webfinger${query}`, {method}), jrdEnv)

describe('the /.well-known/webfinger endpoint', () => {
  it('answers with the document whose subject is the requested resource', async () => {
    const response = await ask('?resource=acct:moritz@softmess.de')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(INDEX[1])
  })

  it('resolves an alias to the document that claims it', async () => {
    const response = await ask('?resource=https://softmess.de/')
    expect(await response.json()).toEqual(INDEX[0])
  })

  it('404s a resource it holds no document for', async () => {
    expect((await ask('?resource=acct:nobody@softmess.de')).status).toBe(404)
  })

  // The failure the Transform Rule alternative could not avoid on this zone's
  // plan: `contains` matching would serve softmess's document here, asserting
  // an identity the query never asked about. Matching is on the whole value.
  it('404s a resource that merely extends a subject it knows', async () => {
    expect((await ask('?resource=acct:softmess@softmess.de.example.org')).status).toBe(404)
  })

  it('400s a request with no resource parameter, as RFC 7033 §4.2 requires', async () => {
    expect((await ask('')).status).toBe(400)
  })

  it('refuses a method that is not a read', async () => {
    const response = await ask('?resource=acct:moritz@softmess.de', 'POST')
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
  })

  it('declares the JRD media type and allows cross-origin reads', async () => {
    // Both are MUSTs — §10.2 for the type, §5 for CORS, without which the
    // browser-side clients this exists for cannot read the response at all.
    const response = await ask('?resource=acct:moritz@softmess.de')
    expect(response.headers.get('content-type')).toBe('application/jrd+json; charset=utf-8')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('allows cross-origin reads of the failures too, as §5 requires', async () => {
    // A 404 without the header does not reach a browser client as a 404 — it
    // surfaces as an opaque network error, indistinguishable from the server
    // being down, so the client cannot tell "not ours" from "try again".
    for (const query of ['', '?resource=acct:nobody@softmess.de']) {
      const response = await ask(query)
      expect(response.headers.get('access-control-allow-origin'), query).toBe('*')
    }
    const rejected = await ask('?resource=acct:moritz@softmess.de', 'POST')
    expect(rejected.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('500s rather than throwing when the built document is not there', async () => {
    // not_found_handling serves the 404 *page*, so an unguarded .json() throws
    // on HTML and the runtime answers every query — the valid ones included —
    // with a Cloudflare error page instead of only the unknown ones.
    const missing = {...env, ASSETS: {fetch: async () => new Response('<html>', {status: 404})}}
    const response = await webfinger(
      new Request('https://softmess.de/.well-known/webfinger?resource=acct:moritz@softmess.de'),
      missing,
    )
    expect(response.status).toBe(500)
  })

  it('returns only the links the rel parameter asked for', async () => {
    const response = await ask('?resource=acct:softmess@softmess.de&rel=me')
    expect((await response.json()).links).toEqual([INDEX[0].links[1]])
  })

  it('keeps the document but drops every link when no rel matches', async () => {
    // §4.3: an unmatched rel narrows the link set, it does not make the
    // resource unknown. A 404 here would be a different claim entirely.
    const response = await ask('?resource=acct:softmess@softmess.de&rel=nonsense')
    expect(response.status).toBe(200)
    expect((await response.json()).links).toEqual([])
  })
})
