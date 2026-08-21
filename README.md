# softmess.de

The [softmess project](https://softmess.de) site. Content lives in Sanity;
the site is a static Astro build on Cloudflare Workers.

|        |                                                             |
| ------ | ----------------------------------------------------------- |
| Site   | https://softmess.de                                         |
| Studio | https://studio.softmess.de                                  |
| Design | `docs/superpowers/specs/2026-08-15-softmess-site-design.md` |

## Develop

    pnpm install
    pnpm dev          # studio on :3333, site on :4321

Secrets go in `.env.local` (gitignored); `.env` holds only the Sanity
project id and dataset.

## Verify

    pnpm verify       # typegen drift, astro check, fixture build, tests

Don't run `pnpm verify` while `pnpm dev` is running — the Studio's typegen
watcher rewrites `site/src/sanity.types.ts` underneath it and the drift check
will report spurious failures.

## Deploy

Pushing to `main` deploys both. Publishing in Sanity redeploys the site only.
