import {describe, expect, it} from 'vitest'
import {evaluate, parse} from 'groq-js'
import {SITE_SETTINGS_QUERY} from '../src/lib/content'

// LINK_PROJECTION does two things no fixture can exercise: it drops links whose
// target does not resolve, and it collapses internal and external links into one
// `{label, href}` shape. Both live entirely in the query string, so this
// evaluates the exported query itself with groq-js against a fabricated
// dataset — the same approach as studio/schemaTypes/page.orphanWarning.test.ts.
// A hand-written stub of "what the query probably returns" would assert the
// guess rather than the guard.
//
// The nav arrays are the surface under test because they are the ones on
// siteSettings; the same projection is what a block's `actions` gets.
async function runNavQuery(dataset: Array<Record<string, unknown>>) {
  const value = await evaluate(parse(SITE_SETTINGS_QUERY), {dataset})
  return (await value.get()) as {
    headerLinks: Array<{_key: string; label: string | null; href: string | null}> | null
    footerLinks: Array<{_key: string; label: string | null; href: string | null}> | null
  }
}

const impressum = {
  _id: 'page-impressum',
  _type: 'page',
  title: 'Impressum',
  slug: {current: 'impressum'},
}

function settings(fields: Record<string, unknown>) {
  return {_id: 'siteSettings', _type: 'siteSettings', ...fields}
}

describe('LINK_PROJECTION, via SITE_SETTINGS_QUERY', () => {
  it('drops a link whose page was deleted', async () => {
    const nav = await runNavQuery([
      settings({
        footerLinks: [
          {
            _key: 'impressum',
            _type: 'action',
            linkType: 'internal',
            page: {_ref: 'page-impressum'},
          },
          {_key: 'geloescht', _type: 'action', linkType: 'internal', page: {_ref: 'page-weg'}},
        ],
      }),
      impressum,
    ])
    expect(nav.footerLinks?.map((link) => link._key)).toEqual(['impressum'])
  })

  it('drops a link to a page that exists only as a draft', async () => {
    // The build fetches on the published perspective, where `drafts.` documents
    // are not visible — an editor who linked a never-published page hits this.
    const nav = await runNavQuery([
      settings({
        headerLinks: [
          {_key: 'entwurf', _type: 'action', linkType: 'internal', page: {_ref: 'page-entwurf'}},
        ],
      }),
      {_id: 'drafts.page-entwurf', _type: 'page', title: 'Entwurf', slug: {current: 'entwurf'}},
    ])
    expect(nav.headerLinks).toEqual([])
  })

  it('drops an external link with no address', async () => {
    const nav = await runNavQuery([
      settings({
        footerLinks: [{_key: 'leer', _type: 'action', linkType: 'external', label: 'Shop'}],
      }),
    ])
    expect(nav.footerLinks).toEqual([])
  })

  it('resolves an internal link to a root-relative href', async () => {
    const nav = await runNavQuery([
      settings({
        footerLinks: [
          {
            _key: 'impressum',
            _type: 'action',
            linkType: 'internal',
            // Deliberately not the page title, so this pins "the label wins"
            // rather than reading the same string from either branch.
            label: 'Rechtliches',
            page: {_ref: 'page-impressum'},
          },
        ],
      }),
      impressum,
    ])
    expect(nav.footerLinks).toEqual([{_key: 'impressum', label: 'Rechtliches', href: '/impressum'}])
  })

  it('falls back to the page title when an internal link has no label', async () => {
    const nav = await runNavQuery([
      settings({
        footerLinks: [
          {
            _key: 'impressum',
            _type: 'action',
            linkType: 'internal',
            page: {_ref: 'page-impressum'},
          },
        ],
      }),
      impressum,
    ])
    expect(nav.footerLinks).toEqual([{_key: 'impressum', label: 'Impressum', href: '/impressum'}])
  })

  it('passes an external link through verbatim', async () => {
    const nav = await runNavQuery([
      settings({
        headerLinks: [
          {
            _key: 'shop',
            _type: 'action',
            linkType: 'external',
            label: 'Shop',
            href: 'https://example.com/shop',
          },
        ],
      }),
    ])
    expect(nav.headerLinks).toEqual([
      {_key: 'shop', label: 'Shop', href: 'https://example.com/shop'},
    ])
  })

  it('ignores a stale page reference left behind on an external link', async () => {
    // Switching a link from internal to external hides the reference field but
    // does not clear it, so both branches can hold data at once. linkType is
    // what decides, not whichever field happens to be set.
    const nav = await runNavQuery([
      settings({
        headerLinks: [
          {
            _key: 'shop',
            _type: 'action',
            linkType: 'external',
            label: 'Shop',
            href: 'https://example.com/shop',
            page: {_ref: 'page-impressum'},
          },
        ],
      }),
      impressum,
    ])
    expect(nav.headerLinks?.[0]?.href).toBe('https://example.com/shop')
  })

  it('drops an external link with no address but a stale page reference', async () => {
    // The `href` branch is the one linkType selects, so the resolvable page must
    // not smuggle the link past the filter — it would then render `href={null}`,
    // which is the exact case the filter exists to prevent.
    const nav = await runNavQuery([
      settings({
        headerLinks: [
          {
            _key: 'shop',
            _type: 'action',
            linkType: 'external',
            label: 'Shop',
            page: {_ref: 'page-impressum'},
          },
        ],
      }),
      impressum,
    ])
    expect(nav.headerLinks).toEqual([])
  })
})
