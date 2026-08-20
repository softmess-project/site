import {describe, expect, it} from 'vitest'
import {HEADLESS_BLOCKS, pageBuilder} from './pageBuilder'

// The heading rule guards a coupling that lives in the frontend: the first
// block is the one rendered at h1, and the blocks in HEADLESS_BLOCKS render no
// heading at all. Capture the function actually handed to `.custom()` rather
// than restating the rule, so the assertions run against the real validator.
function captureHeadingValidator() {
  let captured!: (blocks: Array<{_type?: string}> | undefined) => string | true
  const stubRule = {
    required: () => stubRule,
    min: () => stubRule,
    error: () => stubRule,
    warning: () => stubRule,
    custom: (fn: typeof captured) => {
      captured = fn
      return stubRule
    },
  }
  pageBuilder.validation!(stubRule as never)
  return captured
}

// Read off `of` rather than listed here, so a new block type is covered the day
// it is added to the schema. Nothing in this package knows whether a block
// renders a heading, so the assertion can only pin each type against
// HEADLESS_BLOCKS — but an added type that belongs on that list and is missing
// from it shows up as a test that claims the block is fine to put first.
const BLOCK_TYPES = pageBuilder.of!.map((member) => (member as {type: string}).type)

describe('pageBuilder heading warning', () => {
  const validate = captureHeadingValidator()

  it('covers every block type the schema accepts', () => {
    expect(BLOCK_TYPES.length).toBeGreaterThan(0)
    expect(BLOCK_TYPES).toEqual(expect.arrayContaining(HEADLESS_BLOCKS))
  })

  it.each(BLOCK_TYPES)('classifies %s as first block by HEADLESS_BLOCKS', (type) => {
    const result = validate([{_type: type}])
    if (HEADLESS_BLOCKS.includes(type)) {
      expect(result).toContain('Hauptüberschrift')
    } else {
      expect(result).toBe(true)
    }
  })

  it('accepts a headless block that is not first, since only the first owns the h1', () => {
    expect(validate([{_type: 'hero'}, {_type: HEADLESS_BLOCKS[0]}])).toBe(true)
  })

  it('leaves an empty page to the required rule rather than warning twice', () => {
    expect(validate([])).toBe(true)
    expect(validate(undefined)).toBe(true)
  })
})
