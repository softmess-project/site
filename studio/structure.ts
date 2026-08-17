import type {StructureResolver} from 'sanity/structure'
import {CogIcon} from '@sanity/icons/Cog'
import {HomeIcon} from '@sanity/icons/Home'
import {DocumentIcon} from '@sanity/icons/Document'
import {DocumentTextIcon} from '@sanity/icons/DocumentText'

// The two legal pages get their own grouped list instead of living among
// ordinary Seiten — §5 of the design spec.
const LEGAL_SLUGS = ['impressum', 'datenschutz']

export const structure: StructureResolver = (S) =>
  S.list()
    .title('Content')
    .items([
      S.listItem()
        .title('Website-Einstellungen')
        .icon(CogIcon)
        .child(S.document().schemaType('siteSettings').documentId('siteSettings')),
      S.listItem()
        .title('Startseite')
        .icon(HomeIcon)
        .child(S.document().schemaType('homePage').documentId('homePage')),
      S.divider(),
      S.listItem()
        .title('Seiten')
        .icon(DocumentIcon)
        .child(
          S.documentList()
            .title('Seiten')
            .filter('_type == "page" && !(slug.current in $slugs)')
            .params({slugs: LEGAL_SLUGS}),
        ),
      S.listItem()
        .title('Rechtliches')
        .icon(DocumentTextIcon)
        .child(
          S.documentList()
            .title('Rechtliches')
            .filter('_type == "page" && slug.current in $slugs')
            .params({slugs: LEGAL_SLUGS}),
        ),
    ])
