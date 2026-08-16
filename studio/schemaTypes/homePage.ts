import {defineField, defineType} from 'sanity'
import {HomeIcon} from '@sanity/icons/Home'

export const homePage = defineType({
  name: 'homePage',
  title: 'Startseite',
  type: 'document',
  icon: HomeIcon,
  fields: [defineField({name: 'pageBuilder', title: 'Inhalt', type: 'pageBuilder'})],
  preview: {prepare: () => ({title: 'Startseite'})},
})
