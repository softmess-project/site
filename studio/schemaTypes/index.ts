import {action} from './action'
import {cta} from './blocks/cta'
import {gallery} from './blocks/gallery'
import {hero} from './blocks/hero'
import {imageText} from './blocks/imageText'
import {richText} from './blocks/richText'
import {homePage} from './homePage'
import {navLink} from './navLink'
import {page} from './page'
import {pageBuilder} from './pageBuilder'
import {siteSettings} from './siteSettings'

export const schemaTypes = [
  siteSettings,
  homePage,
  page,
  navLink,
  pageBuilder,
  hero,
  richText,
  imageText,
  gallery,
  cta,
  action,
]
