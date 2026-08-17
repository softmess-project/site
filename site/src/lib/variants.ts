import {stegaClean} from '@sanity/client/stega'

/** Strip stega markers from a value that is about to be compared. Never call
 *  this on Portable Text — it removes the markers that make overlays work. */
export function clean(value: string | undefined): string | undefined {
  return value === undefined ? undefined : (stegaClean(value) as string)
}

/** Map a variant string to a class, falling back when it is missing or unknown. */
export function pick<T extends string>(
  value: string | undefined,
  map: Record<T, string>,
  fallback: T,
): string {
  const key = clean(value) as T | undefined
  return (key && map[key]) || map[fallback]
}
