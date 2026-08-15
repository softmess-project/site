import {defineField, defineType} from 'sanity'
import {CogIcon} from '@sanity/icons/Cog'

export const siteSettings = defineType({
  name: 'siteSettings',
  title: 'Site settings',
  type: 'document',
  icon: CogIcon,
  fields: [
    defineField({name: 'brand', type: 'string', validation: (rule) => rule.required()}),
    defineField({
      name: 'tagline',
      type: 'string',
      description: 'The small word beside the wordmark, e.g. "project"',
    }),
    defineField({name: 'email', type: 'string', validation: (rule) => rule.required().email()}),
    defineField({
      name: 'instagram',
      type: 'url',
      validation: (rule) => rule.required().uri({scheme: ['https']}),
    }),
    defineField({
      name: 'instagramHandle',
      type: 'string',
      description: 'Display text, e.g. "@softmess.project"',
    }),
    defineField({name: 'copyright', type: 'string'}),
    defineField({
      name: 'backLabel',
      type: 'string',
      description: 'The link back to the home page, shown on legal pages and the 404 page',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'instagramLabel',
      type: 'string',
      description: 'How Instagram is named in the footer navigation',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'notFound',
      title: 'Not found page',
      type: 'object',
      options: {collapsible: true, collapsed: true},
      fields: [
        defineField({name: 'heading', type: 'string', validation: (rule) => rule.required()}),
        defineField({name: 'body', type: 'string', validation: (rule) => rule.required()}),
      ],
    }),
    defineField({
      name: 'seo',
      type: 'object',
      options: {collapsible: true, collapsed: false},
      fields: [
        defineField({name: 'title', type: 'string'}),
        defineField({
          name: 'description',
          type: 'text',
          rows: 3,
          validation: (rule) => rule.max(160).warning('Keep under 160 characters'),
        }),
        defineField({name: 'ogImage', type: 'image'}),
      ],
    }),
  ],
  preview: {
    prepare: () => ({title: 'Site settings'}),
  },
})
