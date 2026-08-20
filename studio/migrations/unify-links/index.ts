import {at, defineMigration, set, setIfMissing} from 'sanity/migrate'

/** `action` and `navLink` became one type, and both gained a `linkType`
 *  discriminant that decides whether the target is a page reference or a URL.
 *  Existing data predates that field, so every link would read as
 *  `linkType: undefined` — which LINK_FILTER treats as internal, dropping every
 *  button on the site because none of them has a page reference.
 *
 *  Old data is unambiguous: an `action` always carried an `href`, a `navLink`
 *  always carried a `page` reference.
 *
 *  Already applied to `production` (6 documents, 5 mutations). Kept as the
 *  record of what happened; re-running is a no-op, since every branch is
 *  guarded on the field still being absent.
 *
 *      pnpm --filter studio exec sanity migrations run unify-links            # dry run
 *      pnpm --filter studio exec sanity migrations run unify-links --no-dry-run --no-confirm
 */
export default defineMigration({
  title: 'Unify action and navLink into one link type',
  documentTypes: ['siteSettings', 'homePage', 'page'],
  migrate: {
    object(node, path) {
      const type = (node as {_type?: string})._type

      // navLink only ever appeared in the two nav arrays, and only ever held a
      // page reference.
      if (type === 'navLink') {
        return [at('_type', set('action')), at('linkType', setIfMissing('internal'))]
      }

      // An `action` predating the split is external by construction: `href`
      // was its only target field.
      if (type === 'action' && !('linkType' in node)) {
        return at('linkType', set('external'))
      }

      // The rich-text annotation kept its `_type`, so it needs the same
      // treatment. `path` disambiguates it from anything else named link.
      if (type === 'link' && !('linkType' in node) && path.includes('markDefs')) {
        return at('linkType', set('external'))
      }

      return undefined
    },
  },
})
