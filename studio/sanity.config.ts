import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {presentationTool} from 'sanity/presentation'
import {visionTool} from '@sanity/vision'
import {deDELocale} from '@sanity/locale-de-de'
import {schemaTypes} from './schemaTypes'
import {structure} from './structure'
import {resolve} from './presentation/resolve'
import {localeOverrides} from './lib/locale'
import {pageHref, slugOf} from './lib/pageHref'
import {SINGLETON_TYPES} from './lib/singletons'

// Local dev is the default so a Studio run from a checkout talks to the site
// running beside it (`pnpm dev` puts it on :4321). The deployed Studio gets the
// real preview origin from the SANITY_STUDIO_PREVIEW_ORIGIN repository
// variable, which must match the Worker's workers.dev hostname — the preview
// Worker cannot live on the softmess.de zone, where its subrequests to
// api.sanity.io come back 525.
//
// Read from both places on purpose. `sanity build` exposes SANITY_STUDIO_* via
// import.meta.env, and separately shims `process.env` to `{}` for browser code.
// Which of the two wins is not stable: a local build folded
// `process.env.SANITY_STUDIO_PREVIEW_ORIGIN` to the literal, while CI compiled
// the same source to `{}.SANITY_STUDIO_PREVIEW_ORIGIN` — undefined — and
// silently shipped a Studio whose Presentation pane opened localhost:4321
// against the production Studio. import.meta.env is the mechanism Sanity
// documents; process.env stays as a fallback so neither build can regress.
// `import.meta` is typed by the tsconfig's module setting, which does not carry
// Vite's `env`, so reach it through a cast rather than pulling vite/client types
// into a config that otherwise needs none.
const buildEnv = (
  import.meta as unknown as {env?: {DEV?: boolean; SANITY_STUDIO_PREVIEW_ORIGIN?: string}}
).env

/** Falling back to localhost outside dev is what actually broke the deployed
 *  Studio: `deploy.yml` is the only place SANITY_STUDIO_PREVIEW_ORIGIN is set,
 *  so a `sanity build` run from anywhere else — a laptop, a manual
 *  `wrangler deploy` — shipped a Presentation pane that iframed
 *  http://localhost:4321. That deploys and loads without complaint; the only
 *  symptom is "Unable to connect to visual editing" in the console, because the
 *  iframe is either empty or someone's local dev server. Verified against the
 *  live bundle, which read `{BASE_URL,DEV,MODE,PROD,SSR}.SANITY_STUDIO_PREVIEW_ORIGIN`
 *  — the key was simply absent — while a build *with* the variable inlines it.
 *
 *  So localhost is a dev-only default now. A production build that forgets the
 *  variable points at the real preview Worker instead of quietly at nothing. */
export function resolvePreviewOrigin(
  env: {DEV?: boolean; SANITY_STUDIO_PREVIEW_ORIGIN?: string} | undefined,
  processOrigin: string | undefined,
): string {
  return (
    env?.SANITY_STUDIO_PREVIEW_ORIGIN ??
    processOrigin ??
    (env?.DEV ? 'http://localhost:4321' : 'https://softmess-preview.9dev.workers.dev')
  )
}

const previewOrigin = resolvePreviewOrigin(buildEnv, process.env.SANITY_STUDIO_PREVIEW_ORIGIN)

/** Origin of the live site, derived from where the Studio itself is served
 *  rather than configured: the deployed Studio is `studio.softmess.de`, so
 *  dropping the `studio.` label yields the site's own origin.
 *
 *  There is no Cloudflare runtime to ask. `softmess-studio` is assets-only —
 *  its wrangler.jsonc has no `main`, so no Worker code runs — and this resolver
 *  runs in the browser regardless. The only host a Worker could report is the
 *  Studio's own Host header, which `window.location` already carries.
 *
 *  A Studio that is not on a `studio.` subdomain (`pnpm dev` on localhost) has
 *  no sibling site to derive, so it falls back to production: the published page
 *  lives on softmess.de no matter where the Studio editing it runs. */
export function resolveSiteOrigin(hostname: string): string {
  return hostname.startsWith('studio.')
    ? `https://${hostname.slice('studio.'.length)}`
    : 'https://softmess.de'
}

export default defineConfig({
  name: 'default',
  title: 'Softmess',

  projectId: '85i3osnk',
  dataset: 'production',

  apps: {
    canvas: {enabled: true},
  },
  releases: {enabled: false},

  plugins: [
    structureTool({structure}),
    presentationTool({
      resolve,
      allowOrigins: ['https://softmess-preview.9dev.workers.dev', 'http://localhost:4321'],
      previewUrl: {
        initial: previewOrigin,
        previewMode: {enable: '/api/draft-mode/enable'},
      },
    }),
    visionTool(),
    deDELocale(),
  ],

  i18n: {bundles: localeOverrides},

  schema: {
    types: schemaTypes,
    templates: (templates) =>
      templates.filter(({schemaType}) => !SINGLETON_TYPES.includes(schemaType as never)),
  },

  document: {
    /** Adds "Veröffentlichte Seite öffnen" to the document menu, pointing at the
     *  page on the live site. Returning `prev` (undefined) hides the item, which
     *  is what siteSettings and an unsaved page without a slug get.
     *
     *  Resolved in the browser, debounced, against the value being edited — so a
     *  draft that has never been published still offers the link, and it will
     *  404 until a publish rebuilds the static site. Presentation is where an
     *  unpublished draft is meant to be looked at. */
    productionUrl: async (prev, {document}) => {
      const href = pageHref(document._type, slugOf(document.slug))

      return href ? `${resolveSiteOrigin(window.location.hostname)}${href}` : prev
    },

    actions: (previous, {schemaType}) =>
      SINGLETON_TYPES.includes(schemaType as (typeof SINGLETON_TYPES)[number])
        ? previous.filter(({action}) => action !== 'delete' && action !== 'duplicate')
        : previous,
  },
})
