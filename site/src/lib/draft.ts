import type {AstroCookies} from 'astro'

export const DRAFT_COOKIE = 'sanity-draft-mode'

/** Constant-time compare, so the cookie cannot be recovered a byte at a time.
 *  Length is allowed to leak: it is fixed by whoever provisioned the secret. */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Draft mode exists only on the preview deployment. On the static build the
 *  constant folds to `false` and this whole branch is eliminated.
 *
 *  The cookie carries PREVIEW_DRAFT_SECRET, not a bare `1`. It used to carry
 *  the `1`, which was safe only because Cloudflare Access fronted the host and
 *  an anonymous request never reached this code. The preview Worker now runs on
 *  workers.dev — where Access cannot follow, because Access applications bind to
 *  hostnames in a zone you control — so the cookie is the gate again and has to
 *  be unguessable. It is issued only by the handshake, and only after
 *  `validatePreviewUrl` has already checked a real Sanity preview secret.
 *
 *  The secret arrives through process.env, which nodejs_compat populates from
 *  the Worker's bindings — the same route lib/sanity.ts uses for the Sanity
 *  token. In the static build it is simply undefined, which is the correct
 *  answer there.
 *
 *  Fails closed: an absent or empty binding means no draft mode at all, never
 *  "any cookie will do". `site/test/live.test.ts` asserts a forged cookie is
 *  refused by the deployed Worker. */
export function isDraftMode(cookies: AstroCookies, secret: string | undefined): boolean {
  if (!import.meta.env.PREVIEW) return false
  if (!secret) return false
  const value = cookies.get(DRAFT_COOKIE)?.value
  return typeof value === 'string' && secretsMatch(value, secret)
}
