import {defineType} from 'sanity'
import {LinkIcon} from '@sanity/icons/Link'
import {linkFields, linkTargetSelection, linkTargetSubtitle} from './linkFields'

/** A bare link target, used as the rich-text annotation: the marked-up text is
 *  the label, so this type carries none. */
export const link = defineType({
  name: 'link',
  title: 'Link',
  type: 'object',
  icon: LinkIcon,
  fields: linkFields,
  preview: {
    select: linkTargetSelection,
    prepare: (selection) => ({
      title: linkTargetSubtitle(selection) ?? 'Ohne Ziel',
    }),
  },
})
