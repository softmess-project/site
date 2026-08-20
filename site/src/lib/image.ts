import {createImageUrlBuilder, type SanityImageSource} from '@sanity/image-url'

// The builder only needs the project coordinates, not a live client, so this
// works offline and in fixture mode.
const builder = createImageUrlBuilder({
  projectId: process.env.SANITY_PROJECT_ID ?? '85i3osnk',
  dataset: process.env.SANITY_DATASET ?? 'production',
})

/** Rewrite a `cdn.sanity.io` URL onto our own origin, where `src/worker.ts`
 *  proxies it. This is what lets the privacy policy stop disclosing that a
 *  visitor's IP reaches Sanity — Sanity sees Cloudflare's egress instead.
 *
 *  Gated on PROXY_IMAGES, which is off by default and never on for preview —
 *  see astro.config.mjs for why the safe shape is the default. Both flags are
 *  inlined at build time, so the losing branch is eliminated entirely. */
function sameOrigin(url: string): string {
  if (!import.meta.env.PROXY_IMAGES) return url
  return url.replace('https://cdn.sanity.io/', '/cdn/')
}

/** The og:image box, and the facts about it that Open Graph wants declared.
 *  Exported so lib/seo.ts emits width/height/type from the same numbers the
 *  URL is built with, rather than restating them. */
export const SOCIAL_IMAGE = {width: 1200, height: 630, type: 'image/jpeg'} as const

/** An absolute cdn.sanity.io URL, deliberately never rewritten onto our own
 *  origin. For consumers that are not a visitor's browser: social scrapers and
 *  the build-time favicon fetch. Proxying those buys no privacy — the request
 *  does not come from a visitor — while /cdn/* is exactly the route that gets
 *  HTTP 525 on this zone (docs/BACKLOG.md §1.1), so a proxied og:image would
 *  make every share card imageless. */
export function cdnSrcFor(
  source: SanityImageSource,
  width: number,
  height: number,
  format: 'jpg' | 'png' | 'webp',
): string {
  return builder.image(source).width(width).height(height).format(format).quality(80).url()
}

/** One image URL at a fixed CSS box. Passing both dimensions is what makes
 *  Sanity apply the asset's hotspot/crop instead of a naive centre crop. */
export function srcFor(source: SanityImageSource, width: number, height: number): string {
  return sameOrigin(cdnSrcFor(source, width, height, 'webp'))
}

/** The share-card image. JPEG on purpose: LinkedIn's and Facebook's scrapers
 *  do not reliably render a WebP og:image, and the failure is silent — the tag
 *  is there, the URL resolves, and the card renders with no image at all. */
export function socialSrcFor(source: SanityImageSource): string {
  return cdnSrcFor(source, SOCIAL_IMAGE.width, SOCIAL_IMAGE.height, 'jpg')
}

/** A 1x/2x srcset at the same box, so the 1x candidate and `src` agree. */
export function srcSetFor(source: SanityImageSource, width: number, height: number): string {
  return [1, 2]
    .map((density) => `${srcFor(source, width * density, height * density)} ${density}x`)
    .join(', ')
}
