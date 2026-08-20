import type {APIRoute} from 'astro'
import {getSitemap} from '../lib/content'

// No <lastmod>: it would mean projecting `_updatedAt` as well, and search
// engines discount the field unless it is provably accurate. A three-route
// sitemap gains nothing from it.
export const GET: APIRoute = async ({locals, site}) => {
  // Nothing on workers.dev belongs in a sitemap, and robots.txt there says
  // Disallow: / anyway, so this route 404s in that build.
  if (import.meta.env.PREVIEW) {
    return new Response(null, {status: 404})
  }

  const {siteExcluded, homeExcluded, slugs} = await getSitemap(locals.sanity)

  // The site-wide switch empties the sitemap rather than dropping the route: an
  // empty urlset is valid, and a 404 here would look like a broken deploy to
  // the Search Console property that already knows this URL. `/` is spelled out
  // because it is a literal route (index.astro) with no list to derive it from.
  const slugPaths = slugs.map((slug) => `/${slug}`)
  const paths = siteExcluded ? [] : homeExcluded ? slugPaths : ['/', ...slugPaths]

  const urls = paths.map((path) => `  <url><loc>${new URL(path, site).href}</loc></url>`).join('\n')

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    {headers: {'content-type': 'application/xml; charset=utf-8'}},
  )
}
