import imageUrlBuilder from '@sanity/image-url'
import type {SanityImageSource} from '@sanity/image-url/lib/types/types'

// The builder only needs the project coordinates, not a live client, so this
// works offline and in fixture mode.
const builder = imageUrlBuilder({
  projectId: process.env.SANITY_PROJECT_ID ?? '85i3osnk',
  dataset: process.env.SANITY_DATASET ?? 'production',
})

export function urlFor(source: SanityImageSource) {
  return builder.image(source)
}

/** A 1x/2x srcset for a fixed CSS width. */
export function srcSetFor(source: SanityImageSource, width: number): string {
  return [1, 2]
    .map((density) => `${urlFor(source).width(width * density).format('webp').quality(80).url()} ${density}x`)
    .join(', ')
}
