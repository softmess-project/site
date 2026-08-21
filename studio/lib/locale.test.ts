import {expect, it} from 'vitest'
import {createWorkspaceFromConfig} from 'sanity'
import config from '../sanity.config'

/** The override only works if the config's own bundle is merged after the
 *  plugin's, and if de-DE is the locale editors actually get. Neither is visible
 *  in the config, so resolve the real workspace and ask its i18n instance. */
it('overrides the de-DE string @sanity/locale-de-de ships', async () => {
  // Resolving a workspace wants a signed-in user; i18n does not care, and the
  // option is typed without the `| null` the runtime accepts.
  const {i18n} = await createWorkspaceFromConfig({...config, currentUser: null as never})

  await i18n.loadNamespaces(['structure'])

  expect(i18n.currentLocale.id).toBe('de-DE')
  expect(i18n.t('production-preview.menu-item.title', {ns: 'structure'})).toBe(
    'Veröffentlichte Seite öffnen',
  )
})
