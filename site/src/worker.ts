/**
 * The public site is a static-assets deployment and stays one: this script is
 * invoked for `/cdn/*` and `/.well-known/webfinger` only (see
 * `run_worker_first` in wrangler.jsonc), and every built page, font and
 * stylesheet is still served straight from assets without running any code.
 *
 * The image proxy exists for one reason. `cdn.sanity.io` was the only third-party origin a
 * visitor's browser contacted, which meant the privacy policy had to disclose
 * that their IP address reaches Sanity. Proxying the images through our own
 * origin removes the disclosure rather than wording it better: Sanity now sees
 * Cloudflare's egress, not the visitor.
 *
 * The preview Worker deliberately does not carry this route — it is editor-only
 * and never public, so it keeps the direct `cdn.sanity.io` URLs (see
 * `sameOrigin` in lib/image.ts).
 *
 * WebFinger exists because RFC 7033 is a query protocol and this site is a pile
 * of files: the asset router ignores the query string entirely, so it would
 * answer every `?resource=` with one document — including resources that are
 * not ours, where the RFC demands a 404. Deciding that needs code. What it does
 * not need is any identifier: the documents are built from Sanity and this
 * script matches against whatever subjects they declare.
 */

interface Env {
  ASSETS: {fetch(request: Request): Promise<Response>}
  SANITY_PROJECT_ID: string
  SANITY_DATASET: string
}

const CDN_ORIGIN = 'https://cdn.sanity.io'

// Passed through from Sanity so the browser caches exactly as it would have
// done talking to Sanity directly. Deliberately omits content-length and
// content-encoding: the runtime sets those for the body it actually emits, and
// copying a stale pair is how a proxy corrupts a response.
const PASS_THROUGH = ['content-type', 'cache-control', 'etag', 'last-modified', 'expires']

/**
 * Map a `/cdn/...` request path to its Sanity URL, or null if it isn't one.
 *
 * Pinned to this project's own id and dataset, and to the single path segment
 * Sanity's asset URLs actually have (`<hash>-<w>x<h>.<ext>`), so the route
 * cannot be used as a general-purpose open proxy.
 */
export function upstreamFor(pathname: string, env: Env): string | null {
  if (!pathname.startsWith('/cdn/')) return null
  const [kind, projectId, dataset, ...rest] = pathname.slice('/cdn/'.length).split('/')
  if (kind !== 'images' && kind !== 'files') return null
  if (projectId !== env.SANITY_PROJECT_ID || dataset !== env.SANITY_DATASET) return null
  if (rest.length !== 1 || rest[0] === '') return null
  return `${CDN_ORIGIN}/${kind}/${projectId}/${dataset}/${rest[0]}`
}

// RFC 7033 fixes this path; wrangler.jsonc names it in `run_worker_first` so
// this script sees the query string the asset router would have thrown away.
const WEBFINGER_PATH = '/.well-known/webfinger'

type Jrd = {
  subject: string
  aliases?: string[]
  links: {rel: string; type?: string; href: string}[]
}

// §5 makes this a MUST on *every* response, not only the successful one.
// Browser-side clients are most of the point, and a 404 without it does not
// reach the caller as a 404 — it surfaces as an opaque network error, which is
// what an unreachable server looks like too.
const CORS = {'access-control-allow-origin': '*'}

/**
 * Answer a WebFinger query from the documents built into the static assets.
 *
 * Deliberately holds no identifier. The subjects live in Sanity and are baked
 * into `/.well-known/webfinger` at build time, because a Worker on this zone
 * cannot reach `api.sanity.io` at all (docs/BACKLOG.md §1.1) — so adding a
 * subject, or the fediverse account later, never touches this file.
 */
export async function webfinger(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: {...CORS, allow: 'GET, HEAD'},
    })
  }

  const url = new URL(request.url)
  const resource = url.searchParams.get('resource')

  // §4.2: absent `resource` is a bad request, not an empty result.
  if (resource === null) return new Response(null, {status: 400, headers: CORS})

  // `ASSETS.fetch` reaches the asset store directly rather than re-entering the
  // edge routing, so naming the very path `run_worker_first` claims is a read
  // and not a loop. Verified under `wrangler dev` before this was written.
  const asset = await env.ASSETS.fetch(new Request(new URL(WEBFINGER_PATH, url)))

  // Not a 404 for the queried resource — we cannot tell either way. Without the
  // guard this is worse than a wrong status: `not_found_handling: "404-page"`
  // hands back the HTML 404, `.json()` throws on it, and *every* query answers
  // with a Cloudflare 500 page rather than only the unknown ones.
  if (!asset.ok) return new Response(null, {status: 500, headers: CORS})

  const index = (await asset.json()) as Jrd[]

  // Whole-value comparison, never a prefix or a substring: `contains` matching
  // would answer for `acct:softmess@softmess.de.example.org` with softmess's
  // document, asserting an identity nobody asked about.
  const jrd = index.find((doc) => doc.subject === resource || doc.aliases?.includes(resource))

  // §4.2: a resource we hold nothing for is a 404, which is the whole reason
  // this route is not a static file.
  if (!jrd) return new Response(null, {status: 404, headers: CORS})

  // §4.3: `rel` narrows the link set and nothing else — the subject still
  // resolves even when no link survives the filter.
  const rels = url.searchParams.getAll('rel')
  const body = rels.length ? {...jrd, links: jrd.links.filter((l) => rels.includes(l.rel))} : jrd

  return new Response(JSON.stringify(body), {
    headers: {
      ...CORS,
      // §10.2.
      'content-type': 'application/jrd+json; charset=utf-8',
      // The documents only change when the site is rebuilt, and one follow of
      // a fediverse handle costs one query per remote server. A Worker response
      // is not edge-cached at all without this, so every one of them would run
      // the script and read the asset again.
      'cache-control': 'public, max-age=3600',
    },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === WEBFINGER_PATH) return webfinger(request, env)

    const upstream = upstreamFor(url.pathname, env)

    // Not an asset path we proxy. Hand back to the asset router, which applies
    // wrangler.jsonc's not_found_handling and serves the 404 page.
    if (!upstream) return env.ASSETS.fetch(request)

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {status: 405, headers: {allow: 'GET, HEAD'}})
    }

    // The query string carries Sanity's transform parameters (w, h, fm, q,
    // rect, fit), so it has to survive.
    const target = new URL(upstream)
    target.search = url.search

    // A fresh request rather than a forwarded one: none of the visitor's
    // headers need to reach Sanity, and not forwarding them is the point.
    const response = await fetch(target, {
      method: request.method,
      headers: {accept: request.headers.get('accept') ?? 'image/*'},
      // Sanity's asset URLs are content-addressed and immutable, so letting
      // Cloudflare cache them at the edge is safe and keeps our egress low.
      cf: {cacheEverything: true},
    } as RequestInit)

    const headers = new Headers()
    for (const name of PASS_THROUGH) {
      const value = response.headers.get(name)
      if (value) headers.set(name, value)
    }

    return new Response(response.body, {status: response.status, headers})
  },
}
