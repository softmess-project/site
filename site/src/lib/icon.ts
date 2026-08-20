import type {SanityClient} from '@sanity/client/stega'
import {getSiteSettings} from './content'
import {cdnSrcFor} from './image'

// A 1×1 transparent PNG, 68 bytes. Stands in for the real icon in the two
// cases where there is nothing to fetch: no icon uploaded yet, and fixture
// mode, whose asset ref is a synthetic zero ID. Both still emit a valid PNG —
// see iconResponse for why never 404-ing is the point.
const STUB_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMB/6X1QwYAAAAASUVORK5CYII='

function stub(): Response {
  return new Response(
    Uint8Array.from(atob(STUB_PNG), (c) => c.charCodeAt(0)),
    {
      headers: {'content-type': 'image/png'},
    },
  )
}

/** The icon at one square size, as bytes we serve ourselves.
 *
 *  The fetch happens at build time, in CI, where nothing is a Worker — so the
 *  zone's outbound-TLS problem (docs/BACKLOG.md §1.1) never applies, and the
 *  bytes land in dist/ as an ordinary static file. Serving the icon straight
 *  from cdn.sanity.io would instead make *every* page contact Sanity,
 *  including the two legal pages and the 404, which today load no images at
 *  all — a regression against the same promise that made the fonts
 *  self-hosted.
 *
 *  This never returns 404, and that is load-bearing. A prerendered endpoint
 *  writes its body to dist/ whatever the status, and Cloudflare's asset router
 *  then serves that file with HTTP 200 — the exact trap already recorded in
 *  astro.config.mjs for /api/draft-mode/enable, which answered 200 on a route
 *  claiming to be absent. So with no icon uploaded this emits a 1×1
 *  transparent PNG: a blank favicon, which is precisely what the site shows
 *  today, and it becomes the real icon the moment one is uploaded. Nothing
 *  downstream has to reason about whether the file exists. */
export async function iconResponse(client: SanityClient, size: number): Promise<Response> {
  const {icon} = await getSiteSettings(client)
  if (!icon?.asset) return stub()

  // The fixture's asset ref is a synthetic zero ID with nothing behind it.
  if (process.env.SANITY_FIXTURES === '1') return stub()

  const response = await fetch(cdnSrcFor(icon, size, size, 'png'))
  if (!response.ok) {
    throw new Error(
      `Das Website-Icon konnte nicht von Sanity geladen werden (HTTP ${response.status}). ` +
        'Ohne es kann die Website nicht gebaut werden.',
    )
  }
  return new Response(await response.arrayBuffer(), {headers: {'content-type': 'image/png'}})
}
