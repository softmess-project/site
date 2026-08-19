import {describe, expect, it} from 'vitest'
import config, {resolvePreviewOrigin} from './sanity.config'

// Fake action components: only the `action` id sanity's built-ins expose
// statically is relevant to the filter, so that's all these need.
const previous = [{action: 'publish'}, {action: 'delete'}, {action: 'duplicate'}] as never

describe('resolvePreviewOrigin', () => {
  it('prefers the build-time variable', () => {
    expect(
      resolvePreviewOrigin({SANITY_STUDIO_PREVIEW_ORIGIN: 'https://from-build'}, undefined),
    ).toBe('https://from-build')
  })

  it('falls back to process.env when the build did not inline it', () => {
    expect(resolvePreviewOrigin({DEV: false}, 'https://from-process')).toBe('https://from-process')
  })

  it('uses localhost only in dev', () => {
    expect(resolvePreviewOrigin({DEV: true}, undefined)).toBe('http://localhost:4321')
  })

  // The regression: a production build with neither source set used to point
  // Presentation at localhost, which loads silently and never connects.
  it('never points a production build at localhost', () => {
    expect(resolvePreviewOrigin({DEV: false}, undefined)).toBe(
      'https://softmess-preview.9dev.workers.dev',
    )
    expect(resolvePreviewOrigin(undefined, undefined)).toBe(
      'https://softmess-preview.9dev.workers.dev',
    )
  })
})

describe('document.actions', () => {
  it('drops delete and duplicate for singleton types', () => {
    const result = config.document!.actions!(previous, {schemaType: 'siteSettings'} as never)

    expect(result.map((a: {action?: string}) => a.action)).toEqual(['publish'])
  })

  it('leaves other types untouched', () => {
    const result = config.document!.actions!(previous, {schemaType: 'post'} as never)

    expect(result.map((a: {action?: string}) => a.action)).toEqual([
      'publish',
      'delete',
      'duplicate',
    ])
  })
})
