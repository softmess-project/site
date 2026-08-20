import {defineField} from 'sanity'
import type {ValidationContext} from 'sanity'

/** `true` when the link points off-site, so `href` is the target and `page` is
 *  irrelevant. An unset `linkType` counts as internal, matching the GROQ side.
 *
 *  `context.parent` is typed as `unknown`, so the cast is the load-bearing part
 *  of every conditional rule below — spelled once here rather than three times,
 *  where a rename of the field would still type-check and silently switch the
 *  validation off. */
export function isExternal(context: ValidationContext): boolean {
  return (context.parent as {linkType?: string} | undefined)?.linkType === 'external'
}

/** The link target, shared by `link` (rich-text annotation) and `action`
 *  (labelled button or navigation entry). Split out rather than duplicated so
 *  the two can never drift into accepting different targets. */
export const linkFields = [
  defineField({
    name: 'linkType',
    title: 'Ziel',
    type: 'string',
    initialValue: 'internal',
    options: {
      list: [
        {title: 'Seite dieser Website', value: 'internal'},
        {title: 'Externe Adresse', value: 'external'},
      ],
      layout: 'radio',
    },
    validation: (rule) => rule.required(),
  }),
  defineField({
    name: 'page',
    title: 'Seite',
    type: 'reference',
    to: [{type: 'page'}],
    hidden: ({parent}) => parent?.linkType === 'external',
    // Not `rule.required()`: the field is only mandatory on the internal
    // branch, and a plain required() would block publishing every external
    // link with an error about a field the editor cannot even see.
    validation: (rule) =>
      rule.custom((page, context) =>
        !isExternal(context) && !page ? 'Bitte eine Seite auswählen' : true,
      ),
  }),
  defineField({
    name: 'href',
    title: 'Adresse',
    type: 'url',
    description: 'Vollständige Adresse, z. B. https://instagram.com/… oder mailto:hi@…',
    hidden: ({parent}) => parent?.linkType !== 'external',
    validation: (rule) =>
      rule
        .uri({scheme: ['http', 'https', 'mailto']})
        .custom((href, context) =>
          isExternal(context) && !href ? 'Bitte eine Adresse angeben' : true,
        ),
  }),
]

/** `preview.select` keys `linkTargetSubtitle` needs. Deliberately no
 *  `page.title`: only `action` falls back to it for a missing label, and
 *  selecting it here would dereference the page for every annotation preview
 *  that never reads it. */
export const linkTargetSelection = {
  linkType: 'linkType',
  href: 'href',
  pageSlug: 'page.slug.current',
}

export function linkTargetSubtitle(selection: {
  linkType?: string
  href?: string
  pageSlug?: string
}): string | undefined {
  if (selection.linkType === 'external') return selection.href
  return selection.pageSlug ? `/${selection.pageSlug}` : undefined
}
