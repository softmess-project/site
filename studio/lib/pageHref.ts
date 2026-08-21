/** Path a document is published at, or `null` for documents that have no page
 *  of their own. Shared by Presentation's location resolver and the
 *  "Veröffentlichte Seite öffnen" link in the document menu, so a route change
 *  stays a single edit. */
export function pageHref(type: string | undefined, slug?: string): string | null {
  if (type === 'homePage') return '/'
  if (type === 'page') return slug ? `/${slug}` : null

  return null
}

/** `slug` as the Studio holds it in a document value: a slug object, or nothing
 *  at all on a document that has never been saved. */
export function slugOf(value: unknown): string | undefined {
  return (value as {current?: string} | undefined)?.current
}
