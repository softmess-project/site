import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {presentationTool} from 'sanity/presentation'
import {visionTool} from '@sanity/vision'
import {deDELocale} from '@sanity/locale-de-de'
import {schemaTypes} from './schemaTypes'
import {structure} from './structure'
import {resolve} from './presentation/resolve'
import {SINGLETON_TYPES} from './lib/singletons'

// Cloudflare Workers egress currently can't complete a TLS handshake to
// Sanity's API, so the deployed preview Worker 500s. Defaulting to `pnpm dev`
// (site on :4321) keeps editing usable; flip SANITY_STUDIO_PREVIEW_ORIGIN
// back to the deployed host once that's fixed — this default is not an
// oversight.
const previewOrigin = process.env.SANITY_STUDIO_PREVIEW_ORIGIN ?? 'http://localhost:4321'

export default defineConfig({
  name: 'default',
  title: 'Softmess',

  projectId: '85i3osnk',
  dataset: 'production',

  apps: {
    canvas: {enabled: true},
  },

  releases: { enabled: false },

  plugins: [
    structureTool({structure}),
    presentationTool({
      resolve,
      allowOrigins: ['https://preview.softmess.de', 'http://localhost:4321'],
      previewUrl: {
        initial: previewOrigin,
        previewMode: {enable: '/api/draft-mode/enable'},
      },
    }),
    visionTool(),
    deDELocale(),
  ],

  schema: {
    types: schemaTypes,
    templates: (templates) =>
      templates.filter(({schemaType}) => !SINGLETON_TYPES.includes(schemaType as never)),
  },

  document: {
    actions: (previous, {schemaType}) =>
      SINGLETON_TYPES.includes(schemaType as (typeof SINGLETON_TYPES)[number])
        ? previous.filter(({action}) => action !== 'delete' && action !== 'duplicate')
        : previous,
  },
})
