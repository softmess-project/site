import {describe, expect, it} from 'vitest'
import {isReservedSlug} from '../lib/singletons'

describe('reserved slugs', () => {
  it('reserves the product namespace before any product exists', () => {
    // Retrofitting /produkte/<slug> after a page has claimed /produkte is a
    // breaking URL change, so the namespace is defended from day one.
    expect(isReservedSlug('produkte')).toBe(true)
  })

  it('reserves the api namespace the preview handshake lives under', () => {
    expect(isReservedSlug('api')).toBe(true)
  })

  it('allows an ordinary page slug', () => {
    expect(isReservedSlug('ueber-uns')).toBe(false)
  })
})
