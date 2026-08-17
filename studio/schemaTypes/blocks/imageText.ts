import {defineArrayMember, defineField, defineType} from 'sanity'
import {SplitHorizontalIcon} from '@sanity/icons/SplitHorizontal'

export const imageText = defineType({
  name: 'imageText',
  title: 'Bild mit Text',
  type: 'object',
  icon: SplitHorizontalIcon,
  fields: [
    defineField({
      name: 'image',
      title: 'Bild',
      type: 'image',
      options: {hotspot: true},
      validation: (rule) => rule.required().error('Bitte ein Bild auswählen'),
      fields: [
        defineField({
          name: 'alt',
          title: 'Alternativtext',
          type: 'string',
          validation: (rule) => rule.required().error('Bitte einen Alternativtext eingeben'),
        }),
      ],
    }),
    defineField({
      name: 'heading',
      title: 'Überschrift',
      type: 'string',
      validation: (rule) => rule.required().error('Bitte eine Überschrift eingeben'),
    }),
    defineField({name: 'body', title: 'Text', type: 'text', rows: 5}),
    defineField({
      name: 'actions',
      title: 'Aktionen',
      type: 'array',
      of: [defineArrayMember({type: 'action'})],
    }),
    defineField({
      name: 'imagePosition',
      title: 'Bildposition',
      type: 'string',
      initialValue: 'links',
      options: {
        list: [
          {title: 'Links', value: 'links'},
          {title: 'Rechts', value: 'rechts'},
        ],
        layout: 'radio',
      },
    }),
    defineField({
      name: 'background',
      title: 'Hintergrund',
      type: 'string',
      initialValue: 'normal',
      options: {
        list: [
          {title: 'Normal', value: 'normal'},
          {title: 'Sand', value: 'sand'},
          {title: 'Akzent', value: 'akzent'},
        ],
        layout: 'radio',
      },
    }),
  ],
  preview: {
    select: {title: 'heading', media: 'image'},
    prepare: ({title, media}) => ({
      title: title || 'Bild mit Text',
      subtitle: 'Bild mit Text',
      media: media ?? SplitHorizontalIcon,
    }),
  },
})
