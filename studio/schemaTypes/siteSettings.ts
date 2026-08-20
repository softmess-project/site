import {defineArrayMember, defineField, defineType} from 'sanity'
import {CogIcon} from '@sanity/icons/Cog'

export const siteSettings = defineType({
  name: 'siteSettings',
  title: 'Website-Einstellungen',
  type: 'document',
  icon: CogIcon,
  groups: [
    {name: 'brand', title: 'Marke', default: true},
    {name: 'navigation', title: 'Navigation'},
    {name: 'notFound', title: '404'},
    {name: 'seo', title: 'SEO'},
  ],
  fields: [
    defineField({
      name: 'brand',
      title: 'Marke',
      type: 'string',
      group: 'brand',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'tagline',
      title: 'Slogan',
      type: 'string',
      group: 'brand',
      description: 'Das kleine Wort neben dem Schriftzug, z. B. "project"',
    }),
    defineField({
      name: 'email',
      title: 'E-Mail',
      type: 'string',
      group: 'brand',
      validation: (rule) => rule.required().email(),
    }),
    defineField({
      name: 'instagram',
      title: 'Instagram-Link',
      type: 'url',
      group: 'brand',
      validation: (rule) => rule.required().uri({scheme: ['https']}),
    }),
    defineField({
      name: 'instagramHandle',
      title: 'Instagram-Name',
      type: 'string',
      group: 'brand',
      description: 'Anzeigetext, z. B. "@softmess.project"',
    }),
    defineField({name: 'copyright', title: 'Copyright-Hinweis', type: 'string', group: 'brand'}),
    defineField({
      name: 'icon',
      title: 'Website-Icon',
      type: 'image',
      group: 'brand',
      description:
        'Das kleine Symbol im Browser-Tab und neben dem Suchergebnis. Quadratisch ' +
        'und mindestens 512×512 Pixel.',
    }),
    defineField({
      name: 'backLabel',
      title: 'Zurück-Link',
      type: 'string',
      group: 'navigation',
      description: 'Der Link zurück zur Startseite, gezeigt auf rechtlichen Seiten und der 404-Seite',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'instagramLabel',
      title: 'Instagram-Beschriftung',
      type: 'string',
      group: 'navigation',
      description: 'Wie Instagram in der Fußzeilen-Navigation genannt wird',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'headerLinks',
      title: 'Links in der Kopfzeile',
      type: 'array',
      group: 'navigation',
      of: [defineArrayMember({type: 'action'})],
    }),
    defineField({
      name: 'footerLinks',
      title: 'Links in der Fußzeile',
      type: 'array',
      group: 'navigation',
      of: [defineArrayMember({type: 'action'})],
    }),
    defineField({
      name: 'notFound',
      title: '404-Seite',
      type: 'object',
      group: 'notFound',
      options: {collapsible: true, collapsed: true},
      fields: [
        defineField({
          name: 'heading',
          title: 'Überschrift',
          type: 'string',
          validation: (rule) => rule.required(),
        }),
        defineField({
          name: 'body',
          title: 'Text',
          type: 'string',
          validation: (rule) => rule.required(),
        }),
      ],
    }),
    defineField({
      name: 'seo',
      title: 'Suchmaschinen',
      type: 'seo',
      group: 'seo',
      description: 'Die Vorgabe für jede Seite, die nichts Eigenes hinterlegt hat',
      options: {collapsible: true, collapsed: false},
    }),
  ],
  preview: {
    prepare: () => ({title: 'Website-Einstellungen'}),
  },
})
