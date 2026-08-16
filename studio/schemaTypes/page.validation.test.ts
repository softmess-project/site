import {describe, expect, it} from 'vitest'
import {page} from './page'

// The slug uniqueness rule is defined inline inside the field, so testing it
// means feeding `validation()` a stub Rule that supports only the two
// methods it calls, and capturing the function handed to `.custom()`. Only
// the non-network branches (missing/invalid/reserved) are exercised here —
// the uniqueness check itself needs a live Sanity client.
function captureSlugValidator() {
  const slugField = page.fields.find((field) => field.name === 'slug')!
  let captured!: (
    slug: {current?: string} | undefined,
    context: {document?: {_id: string}; getClient: (options: {apiVersion: string}) => unknown},
  ) => string | true | Promise<string | true>
  const stubRule = {
    required: () => stubRule,
    custom: (fn: typeof captured) => {
      captured = fn
      return stubRule
    },
  }
  slugField.validation!(stubRule as never)
  return captured
}

describe('page slug validation', () => {
  const validate = captureSlugValidator()
  const noNetworkContext = {
    getClient: () => {
      throw new Error('should not be called for a rejected slug')
    },
  }

  it('rejects a missing slug', async () => {
    expect(await validate(undefined, noNetworkContext)).toBe('Bitte eine Adresse angeben')
  })

  it('rejects characters outside the allowed set', async () => {
    expect(await validate({current: 'Über Uns'}, noNetworkContext)).toBe(
      'Nur Kleinbuchstaben, Zahlen und Bindestriche',
    )
  })

  it('rejects a reserved slug before touching the network', async () => {
    expect(await validate({current: 'produkte'}, noNetworkContext)).toBe(
      '"produkte" ist reserviert. Bitte eine andere Adresse wählen.',
    )
  })
})
