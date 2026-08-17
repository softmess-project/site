import type {AstroCookies} from 'astro'

export const DRAFT_COOKIE = 'sanity-draft-mode'

/** Draft mode exists only on the preview deployment. On the static build the
 *  constant folds to `false` and this whole branch is eliminated.
 *
 *  The value is a bare `1` and is deliberately not signed. The design spec
 *  called for a signed cookie because the preview host was public, and a
 *  guessable cookie was then the only thing between the internet and every
 *  unpublished draft. Cloudflare Access now fronts the host, so an anonymous
 *  request never reaches this code and the cookie's job shrank to choosing
 *  published-vs-draft for someone already through the perimeter — a choice
 *  they are entitled to make. Remove the Access application and this becomes
 *  a hole again: `site/test/live.test.ts` asserts the gate is up. */
export function isDraftMode(cookies: AstroCookies): boolean {
  if (!import.meta.env.PREVIEW) return false
  return cookies.get(DRAFT_COOKIE)?.value === '1'
}
