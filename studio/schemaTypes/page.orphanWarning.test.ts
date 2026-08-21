import {describe, expect, it} from 'vitest'
import {evaluate, parse} from 'groq-js'
import {page} from './page'

// The orphan-page warning runs a GROQ query against the live dataset. Rather
// than hand-copying that query into an assertion (which would drift silently
// if the real one changes), this captures the actual validator function
// handed to `.custom()` and evaluates its actual query string with groq-js
// against fabricated siteSettings documents. That's the point: count() of an
// unset array is null in GROQ, and null + n is null, so a document missing
// either nav array must not poison the sum — a hand-written stub of "what
// the query probably returns" would not have caught that.
function captureOrphanValidator() {
  let captured!: (
    doc: {_id?: string} | undefined,
    context: {
      getClient: (options: {apiVersion: string}) => {
        fetch: (query: string, params: Record<string, unknown>) => Promise<unknown>
      }
    },
  ) => string | true | Promise<string | true>
  const stubRule = {
    custom: (fn: typeof captured) => {
      captured = fn
      return stubRule
    },
    warning: () => stubRule,
  }
  page.validation!(stubRule as never)
  return captured
}

// Runs the exact query the validator sends against a fabricated
// `siteSettings` document, using groq-js instead of a mocked answer.
function siteSettingsClient(siteSettingsFields: Record<string, unknown>) {
  const dataset = [{_id: 'siteSettings', _type: 'siteSettings', ...siteSettingsFields}]
  return {
    fetch: async (query: string, params: Record<string, unknown>) => {
      const value = await evaluate(parse(query), {dataset, params})
      return value.get()
    },
  }
}

describe('page orphan-page warning', () => {
  const validate = captureOrphanValidator()
  const WARNING =
    'Diese Seite ist über die Adresse erreichbar, aber von nirgendwo verlinkt. Unter Website-Einstellungen → Navigation kann sie verlinkt werden.'

  it('passes without querying the client for a document that has no _id yet', async () => {
    const result = await validate(undefined, {
      getClient: () => {
        throw new Error('should not query the client without an _id')
      },
    })
    expect(result).toBe(true)
  })

  it("warns when both nav arrays are absent (the dataset's state before any nav is set up)", async () => {
    const context = {getClient: () => siteSettingsClient({})}
    expect(await validate({_id: 'page-a'}, context)).toBe(WARNING)
  })

  it('does not warn when linked only in the header and footerLinks was never touched', async () => {
    const context = {
      getClient: () => siteSettingsClient({headerLinks: [{_key: 'a', page: {_ref: 'page-a'}}]}),
    }
    expect(await validate({_id: 'page-a'}, context)).toBe(true)
  })

  it('does not warn when linked only in the footer and headerLinks was never touched', async () => {
    const context = {
      getClient: () => siteSettingsClient({footerLinks: [{_key: 'a', page: {_ref: 'page-a'}}]}),
    }
    expect(await validate({_id: 'page-a'}, context)).toBe(true)
  })

  it('does not warn when both arrays exist and the page is linked in the header', async () => {
    const context = {
      getClient: () =>
        siteSettingsClient({
          headerLinks: [{_key: 'a', page: {_ref: 'page-a'}}],
          footerLinks: [{_key: 'b', page: {_ref: 'page-other'}}],
        }),
    }
    expect(await validate({_id: 'page-a'}, context)).toBe(true)
  })

  it('does not warn when the page is linked in both header and footer', async () => {
    const context = {
      getClient: () =>
        siteSettingsClient({
          headerLinks: [{_key: 'a', page: {_ref: 'page-a'}}],
          footerLinks: [{_key: 'b', page: {_ref: 'page-a'}}],
        }),
    }
    expect(await validate({_id: 'page-a'}, context)).toBe(true)
  })

  it('strips the drafts. prefix before matching the reference id', async () => {
    const context = {
      getClient: () => siteSettingsClient({headerLinks: [{_key: 'a', page: {_ref: 'page-a'}}]}),
    }
    expect(await validate({_id: 'drafts.page-a'}, context)).toBe(true)
  })
})
