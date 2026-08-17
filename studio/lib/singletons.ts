/** Types that must exist exactly once and must never be deleted. Deleting one
 *  makes every subsequent build fail on a null dereference while the live site
 *  keeps serving stale HTML — a failure that is invisible until publish. */
export const SINGLETON_TYPES = ['siteSettings', 'homePage'] as const

/** URL namespaces a page must never claim. `produkte` is reserved for the
 *  future catalogue; `api` is where the preview handshake lives. */
export const RESERVED_SLUGS = ['produkte', 'api'] as const

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug as (typeof RESERVED_SLUGS)[number])
}
