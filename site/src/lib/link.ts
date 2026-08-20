/** `target`/`rel` for a link that leaves the site, spread onto the anchor.
 *
 *  Every renderer — a block's buttons, both navigations, a rich-text
 *  annotation — decided this for itself, so the heuristic and the
 *  security-relevant attribute pair lived in four places. It is a heuristic:
 *  `linkFields` also allows `mailto:`, which stays in the same tab because a
 *  mail client opening over an empty new tab is worse than one opening over the
 *  page. Switching to the stored `linkType` discriminant is one edit from here.
 */
export function externalAttrs(href?: string | null) {
  return href?.startsWith('http') ? {target: '_blank', rel: 'noopener noreferrer'} : {}
}
