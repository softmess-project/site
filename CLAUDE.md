# CLAUDE.md

- Site tests need the fixture build first. `pnpm --filter site test` does both;
  to run one file: `PROXY_IMAGES=1 pnpm --filter site build:fixtures`, then
  `PROXY_IMAGES=1 pnpm --filter site exec vitest run test/<file>.test.ts`.
- Workers on the `softmess.de` zone get HTTP 525 on outbound TLS to Sanity and
  GitHub. That is why the preview Worker lives on workers.dev and the image proxy
  is off. Do not "fix" this in code; see `docs/BACKLOG.md` §1.1.
- `docs/BACKLOG.md` is the live status of what is blocked, answered and
  deliberately not done. Read it before proposing infrastructure work.
- Version pins are on purpose (studio on eslint 9, TypeScript 6.0.3); see
  `docs/BACKLOG.md` §4.5 before upgrading.
- New page-builder block: also add it to `PAGE_BUILDER_PROJECTION` in
  `site/src/lib/content.ts` with `_key` and `_type` (stega needs `_key`), then
  `pnpm typegen`.
- All editor-facing strings (schema titles, descriptions, validation messages)
  are German. Code and comments are English.
- Comments record failures that were actually observed. Do not delete them when
  editing nearby code.
