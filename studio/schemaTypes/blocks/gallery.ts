import {defineArrayMember, defineField, defineType} from 'sanity'
import {ImagesIcon} from '@sanity/icons/Images'

export const gallery = defineType({
  name: 'gallery',
  title: 'Galerie',
  type: 'object',
  icon: ImagesIcon,
  fields: [
    defineField({
      name: 'images',
      title: 'Bilder',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'image',
          options: {hotspot: true},
          fields: [
            defineField({
              name: 'alt',
              title: 'Alternativtext',
              type: 'string',
              validation: (rule) => rule.required().error('Bitte einen Alternativtext eingeben'),
            }),
          ],
        }),
      ],
      validation: (rule) => rule.min(1).error('Bitte mindestens ein Bild auswählen'),
    }),
    defineField({
      name: 'columns',
      title: 'Spalten',
      type: 'string',
      initialValue: '3',
      options: {
        list: [
          {title: '2 Spalten', value: '2'},
          {title: '3 Spalten', value: '3'},
        ],
        layout: 'radio',
      },
    }),
  ],
  preview: {
    select: {images: 'images', media: 'images.0'},
    prepare: ({images, media}) => ({
      title: `${images?.length ?? 0} Bilder`,
      subtitle: 'Galerie',
      media: media ?? ImagesIcon,
    }),
  },
})
