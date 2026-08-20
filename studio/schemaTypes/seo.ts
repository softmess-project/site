import {defineField, defineType} from 'sanity'
import {SearchIcon} from '@sanity/icons/Search'

/** Shared by `siteSettings` (the site-wide default), `homePage` and `page`, so
 *  the three can never offer different metadata knobs. */
export const seo = defineType({
  name: 'seo',
  title: 'Suchmaschinen',
  type: 'object',
  icon: SearchIcon,
  fields: [
    defineField({
      name: 'title',
      title: 'Titel',
      type: 'string',
      description: 'Überschreibt den Titel im Browser-Tab und in Suchergebnissen',
    }),
    defineField({
      name: 'description',
      title: 'Beschreibung',
      type: 'text',
      rows: 3,
      validation: (rule) => rule.max(160).warning('Möglichst unter 160 Zeichen halten'),
    }),
    defineField({
      name: 'noIndex',
      title: 'Von Suchmaschinen ausschließen',
      type: 'boolean',
      description:
        'Auf einer Seite: diese Seite erscheint nicht in Suchergebnissen. In den ' +
        'Website-Einstellungen: die gesamte Website wird ausgeschlossen.',
      // Inverted on purpose. `initialValue` applies only to newly created
      // documents, so a positively phrased "indexieren" checkbox would read as
      // `undefined` on every document that already exists and would take the
      // whole site out of Google on the next build. Absent means indexed.
      initialValue: false,
    }),
    defineField({
      name: 'ogImage',
      title: 'Vorschaubild',
      type: 'image',
      description: 'Das Bild, das beim Teilen eines Links angezeigt wird. Am besten 1200×630.',
      options: {hotspot: true},
      fields: [
        defineField({
          name: 'alt',
          title: 'Alternativtext',
          type: 'string',
          description: 'Beschreibt das Bild für Menschen, die es nicht sehen können',
        }),
      ],
    }),
  ],
})
