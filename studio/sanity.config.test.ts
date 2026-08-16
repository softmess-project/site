import {describe, expect, it} from 'vitest'
import config from './sanity.config'

// Fake action components: only the `action` id sanity's built-ins expose
// statically is relevant to the filter, so that's all these need.
const previous = [{action: 'publish'}, {action: 'delete'}, {action: 'duplicate'}] as never

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
