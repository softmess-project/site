import {defineLocations, type PresentationPluginOptions} from 'sanity/presentation'
import {pageHref} from '../lib/pageHref'

export const resolve: PresentationPluginOptions['resolve'] = {
  locations: {
    homePage: defineLocations({
      // No fields are needed to resolve a singleton's location, but the
      // installed types require `select` on this branch of the union.
      select: {},
      resolve: () => ({locations: [{title: 'Startseite', href: pageHref('homePage') ?? '/'}]}),
    }),
    page: defineLocations({
      select: {title: 'title', slug: 'slug.current'},
      resolve: (doc) => ({
        locations: [{title: doc?.title || 'Ohne Titel', href: pageHref('page', doc?.slug) ?? '/'}],
      }),
    }),
    // Editing the brand or the footer changes every page, so say so rather
    // than resolving to a single arbitrary one.
    siteSettings: defineLocations({
      select: {},
      resolve: () => ({locations: [{title: 'Jede Seite', href: '/'}]}),
    }),
  },
}
