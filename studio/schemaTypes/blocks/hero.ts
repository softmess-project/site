import {defineArrayMember, defineField, defineType} from 'sanity'
import {StarIcon} from '@sanity/icons/Star'

export const hero = defineType({
  name: 'hero',
  title: 'Aufmacher',
  type: 'object',
  icon: StarIcon,
  fields: [
    defineField({
      name: 'heading',
      title: 'Überschrift',
      type: 'string',
      validation: (rule) => rule.required().error('Bitte eine Überschrift eingeben'),
    }),
    defineField({
      name: 'statement',
      title: 'Statement',
      type: 'string',
      description: 'Die Zeile unter der Überschrift',
    }),
    defineField({
      name: 'body',
      title: 'Text',
      type: 'array',
      description: 'Bis zu zwei Absätze. Der erste wird hervorgehoben.',
      of: [defineArrayMember({type: 'text', rows: 3})],
      validation: (rule) => rule.max(2).warning('Höchstens zwei Absätze'),
    }),
    defineField({
      name: 'image',
      title: 'Bild',
      type: 'image',
      options: {hotspot: true},
      fields: [
        defineField({
          name: 'alt',
          title: 'Alternativtext',
          description: 'Beschreibt das Bild für Menschen, die es nicht sehen können',
          type: 'string',
          validation: (rule) => rule.required().error('Bitte einen Alternativtext eingeben'),
        }),
      ],
    }),
    defineField({
      name: 'imagePosition',
      title: 'Bildposition',
      type: 'string',
      initialValue: 'rechts',
      options: {
        list: [
          {title: 'Links', value: 'links'},
          {title: 'Rechts', value: 'rechts'},
        ],
        layout: 'radio',
      },
    }),
    defineField({
      name: 'actions',
      title: 'Aktionen',
      type: 'array',
      description: 'Knöpfe unter dem Text. Der erste wird gefüllt dargestellt.',
      of: [defineArrayMember({type: 'action'})],
    }),
  ],
  preview: {
    select: {title: 'heading', media: 'image'},
    prepare: ({title, media}) => ({
      title: title || 'Aufmacher',
      subtitle: 'Aufmacher',
      media: media ?? StarIcon,
    }),
  },
})
