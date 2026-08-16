/** Types that must exist exactly once and must never be deleted. Deleting one
 *  makes every subsequent build fail on a null dereference while the live site
 *  keeps serving stale HTML — a failure that is invisible until publish. */
export const SINGLETON_TYPES = ['siteSettings', 'homePage'] as const
