import {defineArrayMember, defineType} from 'sanity'

/** Block types that render no heading of their own. The first block on a page
 *  is the one rendered at `h1` (see site/src/components/PageBuilder.astro), so
 *  a page that opens with one of these ships without an `h1` at all. */
export const HEADLESS_BLOCKS = ['gallery']

export const pageBuilder = defineType({
  name: 'pageBuilder',
  title: 'Inhalt',
  type: 'array',
  of: [
    defineArrayMember({type: 'hero'}),
    defineArrayMember({type: 'richText'}),
    defineArrayMember({type: 'imageText'}),
    defineArrayMember({type: 'gallery'}),
    defineArrayMember({type: 'cta'}),
  ],
  options: {
    insertMenu: {
      views: [
        {name: 'grid', previewImageUrl: (schemaTypeName) => `/static/blocks/${schemaTypeName}.png`},
        {name: 'list'},
      ],
    },
  },
  validation: (rule) => [
    // An empty page still builds — it just renders a bare header and footer,
    // which looks like a deploy failure rather than an unfinished page.
    rule.required().min(1).error('Bitte mindestens einen Block hinzufügen'),
    rule
      .custom<Array<{_type?: string}>>((blocks) =>
        blocks?.[0] && HEADLESS_BLOCKS.includes(blocks[0]._type ?? '')
          ? 'Der erste Block hat keine Überschrift, deshalb bekommt diese Seite keine Hauptüberschrift. Am besten einen Aufmacher davor setzen.'
          : true,
      )
      .warning(),
  ],
})
