import type {HOME_PAGE_QUERY_RESULT} from '../sanity.types'

/** Every block shape the page-builder projection can return. Derived from the
 *  generated query result rather than hand-written, so schema drift surfaces
 *  as a type error in the component instead of as a blank section. */
export type PageBuilderBlock = NonNullable<
  NonNullable<HOME_PAGE_QUERY_RESULT>['pageBuilder']
>[number]

/** One member of that union, picked by `_type`. */
export type BlockOfType<T extends PageBuilderBlock['_type']> = Extract<
  PageBuilderBlock,
  {_type: T}
>
