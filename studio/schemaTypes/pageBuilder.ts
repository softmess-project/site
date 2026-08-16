import {defineArrayMember, defineType} from 'sanity'

export const pageBuilder = defineType({
  name: 'pageBuilder',
  title: 'Inhalt',
  type: 'array',
  of: [
    defineArrayMember({type: 'hero'}),
    defineArrayMember({type: 'richText'}),
    defineArrayMember({type: 'imageText'}),
    defineArrayMember({type: 'gallery'}),
    defineArrayMember({type: 'cta'}),
  ],
  options: {
    insertMenu: {
      views: [
        {name: 'grid', previewImageUrl: (schemaTypeName) => `/static/blocks/${schemaTypeName}.png`},
        {name: 'list'},
      ],
    },
  },
})
