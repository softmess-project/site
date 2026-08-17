import type {APIRoute} from 'astro'
import {validatePreviewUrl} from '@sanity/preview-url-secret'
import {previewSecretClient} from '../lib/sanity'
import {DRAFT_COOKIE} from '../lib/draft'

// Lives outside src/pages and is injected only into the preview build — see the
// preview-routes integration in astro.config.mjs for why.
export const prerender = false

export const GET: APIRoute = async ({request, cookies, redirect}) => {
  const {isValid, redirectTo = '/'} = await validatePreviewUrl(previewSecretClient, request.url)

  if (!isValid) {
    return new Response('Ungültiges oder abgelaufenes Vorschau-Secret', {status: 401})
  }

  // The preview renders inside an iframe on the Studio's origin, so the cookie
  // has to survive being set in a framed context. SameSite=None is what allows
  // that, but the spec requires Secure alongside it — and Safari drops a Secure
  // cookie over plain http, localhost included, so hard-coding both silently
  // broke local preview there: the redirect happened and the cookie vanished.
  // Over http we therefore fall back to Lax, which is sufficient because Studio
  // and preview are same-site in both real setups (localhost differs only by
  // port, and preview/studio.softmess.de share a registrable domain).
  const secure = new URL(request.url).protocol === 'https:'

  cookies.set(DRAFT_COOKIE, '1', {
    path: '/',
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
  })

  return redirect(redirectTo, 307)
}
