import js from '@eslint/js'
import ts from 'typescript-eslint'
import astro from 'eslint-plugin-astro'

// A plain flat-config array rather than typescript-eslint's `config()` helper,
// whose variadic signature is deprecated — astro check reports it as such.
export default [
  // Build output, the Worker sandbox's scratch bundles, and generated types —
  // all gitignored or written by typegen, none of them ours to lint.
  {ignores: ['dist/**', 'dist-fixtures/**', '.astro/**', '.wrangler/**', 'src/sanity.types.ts']},
  js.configs.recommended,
  ...ts.configs.recommended,
  ...astro.configs.recommended,
  // Node globals for the files that run on the build host rather than in a
  // Worker. Spelled out rather than pulling in `globals` for two names.
  {
    files: ['*.mjs', '*.ts', 'test/**', 'scripts/**'],
    languageOptions: {globals: {process: 'readonly', console: 'readonly'}},
  },
]
