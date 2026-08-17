import {stegaClean} from '@sanity/client/stega'

/** Strip stega markers from a value that is about to be compared. Never call
 *  this on Portable Text — it removes the markers that make overlays work. */
export function clean(value: string | undefined): string | undefined {
  return value === undefined ? undefined : (stegaClean(value) as string)
}

/**
 * Map a variant string to a class, falling back when it is missing or unknown.
 *
 * Callers must pass `map` as a named const, not an inline object literal: TS
 * infers `pick`'s type param from the `fallback` argument, so an inline
 * object literal here trips the excess-property check against that
 * narrower inferred type.
 */
export function pick<T extends string>(
  value: string | undefined,
  map: Record<T, string>,
  fallback: T,
): string {
  const key = clean(value) as T | undefined
  return (key && map[key]) || map[fallback]
}
