import {action} from './action'
import {cta} from './blocks/cta'
import {gallery} from './blocks/gallery'
import {hero} from './blocks/hero'
import {imageText} from './blocks/imageText'
import {richText} from './blocks/richText'
import {homePage} from './homePage'
import {link} from './link'
import {page} from './page'
import {pageBuilder} from './pageBuilder'
import {seo} from './seo'
import {siteSettings} from './siteSettings'

export const schemaTypes = [
  siteSettings,
  homePage,
  page,
  link,
  pageBuilder,
  hero,
  richText,
  imageText,
  gallery,
  cta,
  action,
  seo,
]
