import {defineLocaleResourceBundle} from 'sanity'

/** Overrides for strings the bundled locale gets wrong for this Studio.
 *
 *  Registered last in `sanity.config.ts`'s `i18n.bundles`: bundles accumulate in
 *  registration order (plugins first, then the config's own), and `overwrite`
 *  defaults to true, so these win over @sanity/locale-de-de.
 *
 *  Only de-DE needs overriding. Absent a stored user preference the Studio uses
 *  the *last* registered locale as its default, and `deDELocale()` is the only
 *  locale plugin — en-US is reachable only by switching explicitly. */
export const localeOverrides = [
  defineLocaleResourceBundle({
    locale: 'de-DE',
    namespace: 'structure',
    resources: {
      // Upstream: "Vorschau öffnen". That is Presentation's job here — this item
      // opens the page as published on the live site.
      'production-preview.menu-item.title': 'Veröffentlichte Seite öffnen',
    },
  }),
]
