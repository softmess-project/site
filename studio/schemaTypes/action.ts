import {defineField, defineType} from 'sanity'
import {LinkIcon} from '@sanity/icons/Link'
import {isExternal, linkFields, linkTargetSelection, linkTargetSubtitle} from './linkFields'

/** A link with a visible label: the buttons under a block, and every entry in
 *  the header and footer navigation. Same targets as `link`, plus the text. */
export const action = defineType({
  name: 'action',
  title: 'Link',
  type: 'object',
  icon: LinkIcon,
  fields: [
    ...linkFields,
    defineField({
      name: 'label',
      title: 'Beschriftung',
      type: 'string',
      description: 'Leer lassen, um den Titel der verlinkten Seite zu benutzen',
      // Only an internal link has a page title to fall back on. Without a
      // label an external one renders as an empty button.
      validation: (rule) =>
        rule.custom((label, context) =>
          isExternal(context) && !label ? 'Bitte eine Beschriftung eingeben' : true,
        ),
    }),
  ],
  preview: {
    select: {...linkTargetSelection, label: 'label', pageTitle: 'page.title'},
    prepare: (selection) => ({
      title: selection.label || selection.pageTitle || 'Ohne Beschriftung',
      subtitle: linkTargetSubtitle(selection),
    }),
  },
})
