import {defineField, defineType} from 'sanity'
import {LinkIcon} from '@sanity/icons/Link'

export const action = defineType({
  name: 'action',
  title: 'Action',
  type: 'object',
  icon: LinkIcon,
  fields: [
    defineField({
      name: 'label',
      type: 'string',
      description: 'Button text, e.g. "it all happens on instagram"',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'href',
      type: 'url',
      title: 'Link',
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
