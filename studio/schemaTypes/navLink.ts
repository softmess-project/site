import {defineField, defineType} from 'sanity'
import {LinkIcon} from '@sanity/icons/Link'

export const navLink = defineType({
  name: 'navLink',
  title: 'Navigationslink',
  type: 'object',
  icon: LinkIcon,
  fields: [
    defineField({
      name: 'label',
      title: 'Beschriftung',
      type: 'string',
      description: 'Wie der Link heißt. Leer lassen, um den Seitentitel zu benutzen.',
    }),
    defineField({
      name: 'page',
      title: 'Seite',
      type: 'reference',
      to: [{type: 'page'}],
      validation: (rule) => rule.required().error('Bitte eine Seite auswählen'),
    }),
  ],
  preview: {
    select: {label: 'label', title: 'page.title', subtitle: 'page.slug.current'},
    prepare: ({label, title, subtitle}) => ({
      title: label || title || 'Ohne Titel',
      subtitle: subtitle ? `/${subtitle}` : undefined,
    }),
  },
})
