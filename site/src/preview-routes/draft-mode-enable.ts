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

  // Checked after the handshake, not before, so a caller without a valid Sanity
  // secret learns nothing about whether the deployment is configured.
  const secret = process.env.PREVIEW_DRAFT_SECRET
  if (!secret) {
    return new Response('Vorschau ist nicht konfiguriert', {status: 503})
  }

  // The preview renders inside an iframe on the Studio's origin, so the cookie
  // has to survive being set in a framed context. SameSite=None is what allows
  // that, but the spec requires Secure alongside it — and Safari drops a Secure
  // cookie over plain http, localhost included, so hard-coding both silently
  // broke local preview there: the redirect happened and the cookie vanished.
  // Over http we therefore fall back to Lax, which is sufficient because the
  // only http setup is local, where Studio and preview differ only by port and
  // are therefore same-site. Deployed, they are genuinely cross-site — the
  // Worker is on workers.dev and the Studio on softmess.de — so None is not a
  // convenience there but the only value that works.
  const secure = new URL(request.url).protocol === 'https:'

  // The value is the secret itself: on workers.dev there is no perimeter in
  // front of this Worker, so the cookie is what separates a visitor from every
  // unpublished draft. See src/lib/draft.ts.
  //
  // `partitioned` (CHIPS) is what actually made Presentation work. SameSite=None
  // only permits a cross-site cookie; it does not stop the browser blocking it
  // as third-party, which Safari does always and Chrome does in Incognito and
  // whenever the user has turned third-party cookies off. The handshake then
  // redirected correctly and the cookie simply vanished, so draft mode stayed
  // off, Base.astro rendered no visual-editing island — the page shipped no
  // script at all — and Presentation sat on "Could not connect to the preview".
  // Every server-side check passed throughout, which is why this took so long
  // to find: the failure was entirely in the browser's cookie jar.
  //
  // Partitioning keys the cookie to the embedding site (studio.softmess.de), so
  // it is exempt from that blocking, and it tightens the gate rather than
  // loosening it — the cookie is no longer sent from any other embedder.
  // Tied to `secure` because Partitioned requires Secure, and local preview runs
  // over http where the cookie is same-site anyway and needs none of this.
  cookies.set(DRAFT_COOKIE, secret, {
    path: '/',
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    partitioned: secure,
  })

  return redirect(redirectTo, 307)
}
