import {createClient} from '@sanity/client'
import type {SanityClient} from '@sanity/client/stega'

const base = {
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET!,
  apiVersion: '2026-08-15',
  useCdn: false,
  token: process.env.SANITY_API_TOKEN,
}

/** Published content, no source maps. The static build's only client. */
export const publishedClient: SanityClient = createClient({
  ...base,
  perspective: 'published',
})

/** Drafts plus stega source maps, for click-to-edit overlays. Preview only.
 *  Created per request rather than once, so a request without the draft cookie
 *  can never accidentally reuse a drafts-perspective client. */
export function draftClient(): SanityClient {
  return createClient({
    ...base,
    perspective: 'drafts',
    stega: {
      enabled: true,
      studioUrl: process.env.SANITY_STUDIO_URL ?? 'https://studio.softmess.de',
    },
  })
}

/** @deprecated Kept so `content.ts` callers migrate in one place. */
export const client = publishedClient
