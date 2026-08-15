import {defineArrayMember, defineField, defineType} from 'sanity'
import {HomeIcon} from '@sanity/icons/Home'

export const homePage = defineType({
  name: 'homePage',
  title: 'Home page',
  type: 'document',
  icon: HomeIcon,
  fields: [
    defineField({name: 'heading', type: 'string', validation: (rule) => rule.required()}),
    defineField({
      name: 'statement',
      type: 'string',
      description: 'The line under the wordmark, e.g. "follow the white rabbit."',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'body',
      type: 'array',
      description: 'Up to two paragraphs. The first is emphasised, the rest muted.',
      of: [defineArrayMember({type: 'text', rows: 3})],
      validation: (rule) => rule.max(2),
    }),
    defineField({
      name: 'charm',
      type: 'image',
      options: {hotspot: true},
      validation: (rule) => rule.required(),
      fields: [
        defineField({
          name: 'alt',
          type: 'string',
          title: 'Alt text',
          validation: (rule) => rule.required(),
        }),
      ],
    }),
    defineField({
      name: 'actions',
      type: 'array',
      description: 'Buttons under the intro. The first renders filled, the rest outlined.',
      of: [defineArrayMember({type: 'action'})],
    }),
  ],
  preview: {
    prepare: () => ({title: 'Home page'}),
  },
})
