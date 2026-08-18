import {describe, expect, it} from 'vitest'
import {evaluate, parse} from 'groq-js'
import {NAV_QUERY} from '../src/lib/content'

// The dangling-link guard lives in NAV_QUERY's `[defined(page->slug.current)]`
// filters, so it can only be tested by running the query itself: the fixture
// path never executes GROQ, and a hand-written stub of "what the query
// probably returns" would assert the guess rather than the guard. This
// evaluates the exported query string with groq-js against a fabricated
// dataset, the same approach as studio/schemaTypes/page.orphanWarning.test.ts.
async function runNavQuery(dataset: Array<Record<string, unknown>>) {
  const value = await evaluate(parse(NAV_QUERY), {dataset})
  return (await value.get()) as {
    headerLinks: Array<{_key: string; slug: string | null}> | null
    footerLinks: Array<{_key: string; slug: string | null}> | null
  }
}

const impressum = {
  _id: 'page-impressum',
  _type: 'page',
  title: 'Impressum',
  slug: {current: 'impressum'},
}

describe('NAV_QUERY', () => {
  it('drops a link whose page was deleted', async () => {
    const nav = await runNavQuery([
      {
        _id: 'siteSettings',
        _type: 'siteSettings',
        footerLinks: [
          {_key: 'impressum', label: null, page: {_ref: 'page-impressum'}},
          {_key: 'geloescht', label: null, page: {_ref: 'page-weg'}},
        ],
      },
      impressum,
    ])
    expect(nav.footerLinks?.map((link) => link._key)).toEqual(['impressum'])
  })

  it('drops a link to a page that exists only as a draft', async () => {
    // The build fetches on the published perspective, where `drafts.` documents
    // are not visible — an editor who linked a never-published page hits this.
    const nav = await runNavQuery([
      {
        _id: 'siteSettings',
        _type: 'siteSettings',
        headerLinks: [{_key: 'entwurf', label: null, page: {_ref: 'page-entwurf'}}],
      },
      {_id: 'drafts.page-entwurf', _type: 'page', title: 'Entwurf', slug: {current: 'entwurf'}},
    ])
    expect(nav.headerLinks).toEqual([])
  })

  it('keeps links whose page resolves', async () => {
    const nav = await runNavQuery([
      {
        _id: 'siteSettings',
        _type: 'siteSettings',
        footerLinks: [{_key: 'impressum', label: 'Impressum', page: {_ref: 'page-impressum'}}],
      },
      impressum,
    ])
    expect(nav.footerLinks).toEqual([
      {_key: 'impressum', label: 'Impressum', title: 'Impressum', slug: 'impressum'},
    ])
  })
})
