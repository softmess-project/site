import type {APIRoute} from 'astro'
import {validatePreviewUrl} from '@sanity/preview-url-secret'
import {previewSecretClient} from '../../../lib/sanity'
import {DRAFT_COOKIE} from '../../../lib/draft'

// The static public build has no adapter (see astro.config.mjs), so an
// unconditional `prerender = false` breaks it with NoAdapterInstalled. This
// route is meaningless there anyway — draft mode only exists on preview — so
// it prerenders to a static 404 outside of preview instead.
export const prerender = !import.meta.env.PREVIEW

export const GET: APIRoute = async ({request, cookies, redirect}) => {
  if (!import.meta.env.PREVIEW) return new Response('Not found', {status: 404})

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
