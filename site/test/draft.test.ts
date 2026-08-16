import {describe, expect, it} from 'vitest'
import {publishedClient, draftClient} from '../src/lib/sanity'

describe('preview clients', () => {
  it('never asks for drafts on the published client', () => {
    expect(publishedClient.config().perspective).toBe('published')
  })

  it('does not encode stega on the published client', () => {
    // Stega characters in the static build would ship invisible junk to every
    // visitor and break the no-third-party-origin guarantees around SEO tags.
    expect(publishedClient.config().stega?.enabled).toBeFalsy()
  })

  it('asks for drafts and encodes stega on the draft client', () => {
    const client = draftClient()
    expect(client.config().perspective).toBe('drafts')
    expect(client.config().stega?.enabled).toBe(true)
    expect(client.config().stega?.studioUrl).toContain('studio')
  })
})
