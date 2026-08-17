// Temporary diagnostic route, kept while docs/BACKLOG.md §1.1 is open. Delete
// it together with that item.
//
// It answers one question: which hosts can this Worker reach? The preview
// Worker gets HTTP 525 on subrequests to api.sanity.io, cdn.sanity.io and
// github.com, while example.com, www.sanity.io and cloudflare.com are fine —
// and an identical throwaway Worker on workers.dev, same account and same colo,
// reaches all of them. That narrows the fault to this zone's outbound TLS.
//
// It reports statuses only — no credentials, no content — and, living outside
// src/pages, it exists in the preview build alone (astro.config.mjs).
import type {APIRoute} from 'astro'

export const prerender = false

const HOSTS = [
  'https://example.com/',
  'https://www.sanity.io/',
  'https://api.sanity.io/',
  'https://cdn.sanity.io/',
  'https://cloudflare.com/',
  'https://github.com/',
]

export const GET: APIRoute = async () => {
  const results = await Promise.all(
    HOSTS.map(async (host) => {
      const started = Date.now()
      try {
        const response = await fetch(host, {redirect: 'manual'})
        return {host, status: response.status, ms: Date.now() - started}
      } catch (error) {
        return {host, error: String(error).slice(0, 200), ms: Date.now() - started}
      }
    }),
  )

  return new Response(JSON.stringify({results}, null, 1), {
    headers: {'content-type': 'application/json'},
  })
}
