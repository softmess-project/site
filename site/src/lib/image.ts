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
 *  Not applied in the preview build: that Worker is editor-only, never public,
 *  and giving it a second proxy route would buy nothing. `PREVIEW` is inlined
 *  at build time (astro.config.mjs), so one branch or the other is eliminated. */
function sameOrigin(url: string): string {
  if (import.meta.env.PREVIEW) return url
  return url.replace('https://cdn.sanity.io/', '/cdn/')
}

/** One image URL at a fixed CSS box. Passing both dimensions is what makes
 *  Sanity apply the asset's hotspot/crop instead of a naive centre crop. */
export function srcFor(source: SanityImageSource, width: number, height: number): string {
  return sameOrigin(
    builder.image(source).width(width).height(height).format('webp').quality(80).url(),
  )
}

/** A 1x/2x srcset at the same box, so the 1x candidate and `src` agree. */
export function srcSetFor(source: SanityImageSource, width: number, height: number): string {
  return [1, 2]
    .map((density) => `${srcFor(source, width * density, height * density)} ${density}x`)
    .join(', ')
}
