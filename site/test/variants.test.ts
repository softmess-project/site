import {describe, expect, it} from 'vitest'
import {vercelStegaCombine} from '@vercel/stega'
import {clean, pick} from '../src/lib/variants'

const BACKGROUNDS = {normal: 'bg-bg', sand: 'bg-sand-200', akzent: 'bg-accent-200'}

describe('variant mapping', () => {
  it('maps a plain value', () => {
    expect(pick('sand', BACKGROUNDS, 'normal')).toBe('bg-sand-200')
  })

  it('falls back when the value is missing', () => {
    expect(pick(undefined, BACKGROUNDS, 'normal')).toBe('bg-bg')
  })

  it('maps a stega-encoded value instead of silently falling through', () => {
    // Stega encodes an invisible payload into every string when preview is on —
    // roughly 240 characters for a value of this size. Without cleaning,
    // `encoded === 'sand'` is false and every block in the preview renders with
    // its default styling: a bug that appears only in preview, which is exactly
    // where the owner is judging the design.
    const encoded = vercelStegaCombine('sand', {
      origin: 'sanity.io',
      href: 'https://studio.softmess.de',
    })
    expect(encoded).not.toBe('sand')
    expect(clean(encoded)).toBe('sand')
    expect(pick(encoded, BACKGROUNDS, 'normal')).toBe('bg-sand-200')
  })
})
