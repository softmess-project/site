import {defineField, defineType} from 'sanity'
import {HomeIcon} from '@sanity/icons/Home'

export const homePage = defineType({
  name: 'homePage',
  title: 'Startseite',
  type: 'document',
  icon: HomeIcon,
  fields: [
    defineField({name: 'pageBuilder', title: 'Inhalt', type: 'pageBuilder'}),
    // Without this the home page's title and description could only be changed
    // by editing the site-wide SEO defaults, which every other page falls back
    // to as well.
    defineField({
      name: 'seo',
      title: 'Suchmaschinen',
      type: 'seo',
      options: {collapsible: true, collapsed: true},
    }),
  ],
  preview: {prepare: () => ({title: 'Startseite'})},
})
