import type {SanityClient} from '@sanity/client/stega'

declare global {
  namespace App {
    interface Locals {
      /** The client for this request: drafts + stega, or published. */
      sanity: SanityClient
      /** True when this request holds a valid draft-mode cookie. */
      draft: boolean
    }
  }
}

export {}
