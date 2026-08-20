import type {APIRoute} from 'astro'
import {getSiteSettings} from '../lib/content'

// Deliberately not a file in public/: the sitemap URL has to follow whichever
// origin the build targets, and the site-wide exclusion switch on siteSettings
// has to be able to flip the whole file to Disallow. A prerendered endpoint
// lands in dist/robots.txt exactly like a static asset would.
export const GET: APIRoute = async ({locals, site}) => {
  // Two reasons to disallow everything. The preview Worker lives on
  // workers.dev, where Cloudflare Access cannot bind, so Disallow is the only
  // thing keeping it out of search results; PREVIEW is inlined at build time,
  // so only that build short-circuits past the fetch.
  //
  // Note what the siteSettings switch does *not* do: Disallow stops crawling,
  // not indexing, so a URL linked from elsewhere can still surface. The
  // per-page `noindex` meta tag Base.astro emits is what actually removes
  // pages, and the switch sets it on every page too. This is the cheap first
  // line of defence, not the guarantee.
  const disallow = import.meta.env.PREVIEW || !!(await getSiteSettings(locals.sanity)).seo?.noIndex

  return new Response(
    disallow
      ? 'User-agent: *\nDisallow: /\n'
      : `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', site).href}\n`,
    {headers: {'content-type': 'text/plain; charset=utf-8'}},
  )
}
