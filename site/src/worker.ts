/**
 * The public site is a static-assets deployment and stays one: this script is
 * invoked for `/cdn/*` only (see `run_worker_first` in wrangler.jsonc), and
 * every built page, font and stylesheet is still served straight from assets
 * without running any code.
 *
 * It exists for one reason. `cdn.sanity.io` was the only third-party origin a
 * visitor's browser contacted, which meant the privacy policy had to disclose
 * that their IP address reaches Sanity. Proxying the images through our own
 * origin removes the disclosure rather than wording it better: Sanity now sees
 * Cloudflare's egress, not the visitor.
 *
 * The preview Worker deliberately does not carry this route — it is editor-only
 * and never public, so it keeps the direct `cdn.sanity.io` URLs (see
 * `sameOrigin` in lib/image.ts).
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
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
