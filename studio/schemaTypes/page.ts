import {defineField, defineType} from 'sanity'
import {DocumentIcon} from '@sanity/icons/Document'
import {slugifyGerman} from '../lib/slugify'
import {isReservedSlug} from '../lib/singletons'

export const page = defineType({
  name: 'page',
  title: 'Seite',
  type: 'document',
  icon: DocumentIcon,
  fields: [
    defineField({
      name: 'title',
      title: 'Titel',
      type: 'string',
      validation: (rule) => rule.required().error('Bitte einen Titel eingeben'),
    }),
    defineField({
      name: 'slug',
      title: 'Adresse',
      type: 'slug',
      description: 'Der Teil der Web-Adresse nach dem Schrägstrich, z. B. "ueber-uns"',
      options: {source: 'title', maxLength: 96, slugify: slugifyGerman},
      validation: (rule) =>
        rule.required().custom(async (slug, context) => {
          const current = slug?.current
          if (!current) return 'Bitte eine Adresse angeben'
          if (!/^[a-z0-9-]+$/.test(current)) {
            return 'Nur Kleinbuchstaben, Zahlen und Bindestriche'
          }
          if (isReservedSlug(current)) {
            return `"${current}" ist reserviert. Bitte eine andere Adresse wählen.`
          }
          const id = context.document?._id.replace(/^drafts\./, '')
          const taken = await context
            .getClient({apiVersion: '2026-08-15'})
            .fetch<boolean>(
              `defined(*[_type == "page" && slug.current == $slug && !(_id in [$id, "drafts." + $id])][0]._id)`,
              {slug: current, id},
            )
          return taken ? 'Diese Adresse wird bereits von einer anderen Seite benutzt' : true
        }),
    }),
    defineField({
      name: 'pageBuilder',
      title: 'Inhalt',
      type: 'pageBuilder',
    }),
    defineField({
      name: 'seo',
      title: 'Suchmaschinen',
      type: 'object',
      options: {collapsible: true, collapsed: true},
      fields: [
        defineField({name: 'title', title: 'Titel', type: 'string'}),
        defineField({
          name: 'description',
          title: 'Beschreibung',
          type: 'text',
          rows: 3,
          validation: (rule) => rule.max(160).warning('Möglichst unter 160 Zeichen halten'),
        }),
      ],
    }),
  ],
  preview: {
    select: {title: 'title', subtitle: 'slug.current'},
    prepare: ({title, subtitle}) => ({
      title: title || 'Ohne Titel',
      subtitle: subtitle ? `/${subtitle}` : 'Keine Adresse',
    }),
  },
  validation: (rule) =>
    rule.custom(async (doc, context) => {
      if (!doc?._id) return true
      const id = doc._id.replace(/^drafts\./, '')
      const linked = await context.getClient({apiVersion: '2026-08-15'}).fetch<boolean>(
        // navLink stores its reference under `page`, so the refs live at
        // headerLinks[].page._ref — not at headerLinks[]._ref.
        `count(*[_id == "siteSettings"][0].headerLinks[page._ref == $id]) +
         count(*[_id == "siteSettings"][0].footerLinks[page._ref == $id]) > 0`,
        {id},
      )
      return linked
        ? true
        : 'Diese Seite ist über die Adresse erreichbar, aber von nirgendwo verlinkt. Unter Website-Einstellungen → Navigation kann sie verlinkt werden.'
    }).warning(),
})
