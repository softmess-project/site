import {describe, expect, it} from 'vitest'
import {slugifyGerman} from './slugify'

describe('slugifyGerman', () => {
  it('transliterates umlauts rather than lowercasing them', () => {
    // Sanity's default slugify produces "über-uns", which then fails the
    // ^[a-z0-9-]+$ rule on a string that looks lowercase to a German speaker.
    expect(slugifyGerman('Über uns')).toBe('ueber-uns')
    expect(slugifyGerman('Größe & Qualität')).toBe('groesse-qualitaet')
    expect(slugifyGerman('Straße')).toBe('strasse')
  })

  it('collapses separators and trims them from the ends', () => {
    expect(slugifyGerman('  Hallo   Welt!  ')).toBe('hallo-welt')
    expect(slugifyGerman('a---b')).toBe('a-b')
  })

  it('produces only characters the slug validation accepts', () => {
    expect(slugifyGerman('Ärzte & Ärztinnen, 2026')).toMatch(/^[a-z0-9-]+$/)
  })
})
