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

  cookies.set(DRAFT_COOKIE, '1', {
    path: '/',
    httpOnly: true,
    // The preview renders inside an iframe on the Studio's origin. A Lax cookie
    // is not sent in that cross-site context and the handshake fails silently.
    sameSite: 'none',
    secure: true,
  })

  return redirect(redirectTo, 307)
}
