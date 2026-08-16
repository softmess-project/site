import {defineArrayMember, defineField, defineType} from 'sanity'
import {TextIcon} from '@sanity/icons/Text'

export const richText = defineType({
  name: 'richText',
  title: 'Text',
  type: 'object',
  icon: TextIcon,
  fields: [
    defineField({
      name: 'content',
      title: 'Inhalt',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'block',
          styles: [
            {title: 'Absatz', value: 'normal'},
            {title: 'Überschrift', value: 'h2'},
          ],
          lists: [{title: 'Liste', value: 'bullet'}],
          marks: {
            decorators: [
              {title: 'Fett', value: 'strong'},
              {title: 'Kursiv', value: 'em'},
            ],
            annotations: [
              defineArrayMember({
                name: 'link',
                type: 'object',
                title: 'Link',
                fields: [
                  defineField({
                    name: 'href',
                    title: 'Adresse',
                    type: 'url',
                    validation: (rule) =>
                      rule.required().uri({scheme: ['http', 'https', 'mailto']}),
                  }),
                ],
              }),
            ],
          },
        }),
      ],
      validation: (rule) => rule.required().error('Bitte Text eingeben'),
    }),
    defineField({
      name: 'width',
      title: 'Breite',
      type: 'string',
      initialValue: 'schmal',
      options: {
        list: [
          {title: 'Schmal', value: 'schmal'},
          {title: 'Breit', value: 'breit'},
        ],
        layout: 'radio',
      },
    }),
  ],
  preview: {
    select: {content: 'content'},
    prepare: ({content}) => ({
      title: content?.[0]?.children?.[0]?.text || 'Text',
      subtitle: 'Text',
      media: TextIcon,
    }),
  },
})
