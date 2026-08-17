import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {presentationTool} from 'sanity/presentation'
import {visionTool} from '@sanity/vision'
import {deDELocale} from '@sanity/locale-de-de'
import {schemaTypes} from './schemaTypes'
import {structure} from './structure'
import {resolve} from './presentation/resolve'
import {SINGLETON_TYPES} from './lib/singletons'

// Local dev is the default on purpose, not by oversight: the deployed preview
// Worker 500s because subrequests from the softmess.de zone to api.sanity.io
// come back HTTP 525 (see docs/BACKLOG.md §4.1 — measured as zone-scoped, not a
// code fault). `pnpm dev` puts the site on :4321 and keeps editing usable.
// CI overrides this with the SANITY_STUDIO_PREVIEW_ORIGIN repository variable.
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
