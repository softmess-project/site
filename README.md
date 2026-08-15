# softmess.de

The [softmess project](https://softmess.de) site. Content lives in Sanity;
the site is a static Astro build on Cloudflare Workers.

| | |
| --- | --- |
| Site | https://softmess.de |
| Studio | https://studio.softmess.de |
| Design | `docs/superpowers/specs/2026-08-15-softmess-site-design.md` |

## Develop

    pnpm install
    pnpm dev          # studio on :3333, site on :4321

Secrets go in `.env.local` (gitignored); `.env` holds only the Sanity
project id and dataset.

## Verify

    pnpm verify       # typegen drift, astro check, fixture build, tests

## Deploy

Pushing to `main` deploys both. Publishing in Sanity redeploys the site only.
