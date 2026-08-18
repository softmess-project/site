import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {presentationTool} from 'sanity/presentation'
import {visionTool} from '@sanity/vision'
import {deDELocale} from '@sanity/locale-de-de'
import {schemaTypes} from './schemaTypes'
import {structure} from './structure'
import {resolve} from './presentation/resolve'
import {SINGLETON_TYPES} from './lib/singletons'

// Local dev is the default so a Studio run from a checkout talks to the site
// running beside it (`pnpm dev` puts it on :4321). The deployed Studio gets the
// real preview origin from the SANITY_STUDIO_PREVIEW_ORIGIN repository
// variable, which must match the Worker's workers.dev hostname — the preview
// Worker cannot live on the softmess.de zone (docs/CF-525-EVIDENCE.md).
const previewOrigin =
  process.env.SANITY_STUDIO_PREVIEW_ORIGIN ?? 'http://localhost:4321'

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
      allowOrigins: ['https://softmess-preview.9dev.workers.dev', 'http://localhost:4321'],
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
