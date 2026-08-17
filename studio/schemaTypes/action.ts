import {defineField, defineType} from 'sanity'
import {LinkIcon} from '@sanity/icons/Link'

export const action = defineType({
  name: 'action',
  title: 'Aktion',
  type: 'object',
  icon: LinkIcon,
  fields: [
    defineField({
      name: 'label',
      title: 'Beschriftung',
      type: 'string',
      description: 'Button-Text, z. B. "alles passiert auf instagram"',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'href',
      type: 'url',
      title: 'Adresse',
      validation: (rule) =>
        rule
          .required()
          .uri({scheme: ['http', 'https', 'mailto']})
          .error('Must be an http(s) or mailto: link'),
    }),
  ],
  preview: {
    select: {title: 'label', subtitle: 'href'},
  },
})
