import {defineArrayMember, defineField, defineType} from 'sanity'
import {RocketIcon} from '@sanity/icons/Rocket'

export const cta = defineType({
  name: 'cta',
  title: 'Aufruf',
  type: 'object',
  icon: RocketIcon,
  fields: [
    defineField({
      name: 'heading',
      title: 'Überschrift',
      type: 'string',
      validation: (rule) => rule.required().error('Bitte eine Überschrift eingeben'),
    }),
    defineField({name: 'body', title: 'Text', type: 'text', rows: 3}),
    defineField({
      name: 'actions',
      title: 'Aktionen',
      type: 'array',
      of: [defineArrayMember({type: 'action'})],
      validation: (rule) => rule.min(1).error('Bitte mindestens eine Aktion angeben'),
    }),
    defineField({
      name: 'background',
      title: 'Hintergrund',
      type: 'string',
      initialValue: 'akzent',
      options: {
        list: [
          {title: 'Normal', value: 'normal'},
          {title: 'Akzent', value: 'akzent'},
        ],
        layout: 'radio',
      },
    }),
  ],
  preview: {
    select: {title: 'heading'},
    prepare: ({title}) => ({title: title || 'Aufruf', subtitle: 'Aufruf', media: RocketIcon}),
  },
})
