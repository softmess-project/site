import type { AstroCookies } from "astro";

export const DRAFT_COOKIE = "sanity-draft-mode";

/**
 * Draft mode exists only on the preview deployment. On the static build the constant folds to
 *  `false` and this whole branch is eliminated.
 */
export function isDraftMode(cookies: AstroCookies): boolean {
  if (!import.meta.env.PREVIEW) return false;
  return cookies.get(DRAFT_COOKIE)?.value === "1";
}
