// German transliteration must happen *before* lowercasing, so that Ä maps to
// "ae" rather than to "ä" and then to a character the slug rule rejects.
const TRANSLITERATIONS: Array<[RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/Ä/g, 'Ae'],
  [/Ö/g, 'Oe'],
  [/Ü/g, 'Ue'],
  [/ß/g, 'ss'],
]

export function slugifyGerman(input: string): string {
  let value = input
  for (const [pattern, replacement] of TRANSLITERATIONS) {
    value = value.replace(pattern, replacement)
  }
  return (
    value
      .toLowerCase()
      .normalize('NFD')
      // Combining diacritical marks, written as escapes rather than as literal
      // characters — they are invisible in an editor and trivially mangled.
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96)
  )
}
