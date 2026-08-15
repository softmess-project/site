import {createImageUrlBuilder, type SanityImageSource} from '@sanity/image-url'

// The builder only needs the project coordinates, not a live client, so this
// works offline and in fixture mode.
const builder = createImageUrlBuilder({
  projectId: process.env.SANITY_PROJECT_ID ?? '85i3osnk',
  dataset: process.env.SANITY_DATASET ?? 'production',
})

export function urlFor(source: SanityImageSource) {
  return builder.image(source)
}

/** A 1x/2x srcset at a fixed CSS box. Passing both dimensions is what makes
 *  Sanity apply the asset's hotspot/crop instead of a naive centre crop. */
export function srcSetFor(source: SanityImageSource, width: number, height: number): string {
  return [1, 2]
    .map(
      (density) =>
        `${urlFor(source)
          .width(width * density)
          .height(height * density)
          .format('webp')
          .quality(80)
          .url()} ${density}x`,
    )
    .join(', ')
}
