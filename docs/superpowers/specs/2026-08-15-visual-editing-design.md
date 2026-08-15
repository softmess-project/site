# Visual editing — design

Date: 2026-08-15
Status: **superseded** by `2026-08-16-nextjs-page-builder-design.md`, itself
superseded by `2026-08-16-nextjs-foundation-design.md` — read that one.

Not implemented. The requirements that emerged after this was written — a page
builder, and preview that updates without a full reload — are the two things §7
defers as impossible on Astro. Kept for the reasoning in §2.2 and §7, which explains
why the stack changed.

Add live preview and click-to-edit visual editing to the site, driven from the
Studio's Presentation tool.

This supersedes one non-goal in `2026-08-15-softmess-site-design.md` §1, which read
"No visual editing / Presentation tool. Static builds make the payoff small relative
to the wiring cost; revisit if editing becomes frequent." Editing became frequent.
Every other decision in that document — static production build, two Workers,
publish-webhook redeploy — stands unchanged.

## 1. Goals and non-goals

**Goals**

- Editing a document in the Studio shows the result immediately, in the real site.
- Clicking any text or image in that preview opens the field that produced it.
- Production stays a pure static build with no client-side JavaScript and no
  runtime dependency on the Sanity API.
- The published site never contains stega characters, in body copy or in `<head>`.
- Follow Sanity's and Cloudflare's documented paths; own as little glue as possible.

**Non-goals**

- No drag-to-reorder, no in-page text editing. See §7 for why, and what it would take.
- No change to the content model, the queries, or the rendered markup.
- No React in the production bundle. React ships to the preview deployment only.

## 2. Architecture

A third Worker joins the two we have. Production is untouched.

```
                          ┌──────────────────────────┐
  softmess.de             │  static assets, no JS    │  ← astro build
  (unchanged)             │  published perspective   │    at build time
                          └──────────────────────────┘

                          ┌──────────────────────────┐
  studio.softmess.de      │  Studio SPA              │
  (+ presentationTool)    │  iframes preview ────────┼──┐
                          └──────────────────────────┘  │
                                                        ▼
                          ┌──────────────────────────┐
  preview.softmess.de     │  SSR Worker              │  ← astro build
  (new)                   │  drafts perspective      │    --config preview
                          │  stega + overlays        │
                          │  behind Cloudflare Access│
                          └──────────────────────────┘
```

### 2.1 Why a separate preview Worker

Visual editing requires server rendering: the page must be fetched with the `drafts`
perspective and a read token on every request, and stega-encoded so overlays can map
strings back to fields. A static build cannot do any of that.

Making the whole site SSR would buy one less deployment at the cost of a runtime
Sanity dependency on the marketing site, an API token in production, and the loss of
the "publish redeploys a static site" model the original design chose deliberately.
The preview Worker isolates all of it.

Cost: preview and production render from the same source but through two Astro
configs, so a change that breaks only the SSR path can pass a production build. §6
closes that with a preview build in `pnpm verify`.

### 2.2 Why `@sanity/astro`, and what React costs

`@sanity/astro` is the official integration and documents this exact setup: a
`VisualEditing` component, the `PUBLIC_SANITY_VISUAL_EDITING_ENABLED` switch, and a
`loadQuery` helper carrying `perspective: 'drafts'`, `resultSourceMap:
'withKeyArraySelector'`, `stega`, and the read token.

Adopting it means installing `@astrojs/react`, `react`, `react-dom`, `react-is`,
`sanity` and `styled-components` in `site/`. Only React actually executes — the rest
are unused peers of the Studio-embedding feature we don't use. That noise is the
price of the maintained path, and it is preferable to owning the overlay wiring
ourselves.

React is not avoidable by hand-rolling: `enableVisualEditing()` dynamically imports
an overlay system that uses React internally, and `@sanity/visual-editing` declares
`react` and `react-dom` as required peers. The choice is only *whose* wiring we own.

Both `@sanity/astro@3.5.0` and `@sanity/visual-editing@6.0.4` still declare a peer on
`@sanity/client@^7`, while `site/` runs `^8`. pnpm warns and installs. Verify at
implementation that stega encoding and `resultSourceMap` behave; if they don't, pin
`site/`'s client to `^7` rather than abandoning the integration.

## 3. Site changes

### 3.1 Two Astro configs

`site/astro.config.mjs` is untouched: no adapter, default static output, every page
prerendered.

`site/astro.preview.config.mjs` imports it and overrides:

```js
output: 'server'
adapter: cloudflare()
outDir: './dist-preview'
integrations: [...base.integrations, react()]
```

`site/package.json` gains `dev:preview` and `build:preview` scripts pointing at that
config, and the root `verify` script gains `build:preview` (§6). The existing root
`dev` script is unchanged — preview is opt-in, not part of the default loop.

Because the adapter flips *all* pages to on-demand rendering, no page needs an
`export const prerender` line, and `getStaticPaths` in `[slug].astro` is simply
ignored under SSR. This is the whole reason the design carries no per-page
conditionals: the two configs differ, the pages do not.

### 3.2 Data layer

`site/src/lib/sanity.ts` moves to the integration's `sanity:client` module.
`site/src/lib/content.ts` keeps every query and every `get*` function verbatim; only
the fetch call behind them changes, to a `loadQuery` helper:

| Setting | Production build | Preview Worker |
| --- | --- | --- |
| `perspective` | `published` | `drafts` |
| `stega` | `false` | `true` |
| `resultSourceMap` | `false` | `'withKeyArraySelector'` |
| `token` | none | `SANITY_API_READ_TOKEN` (Viewer) |
| `useCdn` | `false` | `false` |

The `SANITY_FIXTURES` branch is unchanged and still short-circuits before any fetch,
so the fixture build and the test suite are unaffected.

The read token must reach the Worker at runtime, from a `wrangler secret`, not be
inlined into the bundle at build time as the integration's README example does — CI
would otherwise bake a rotatable credential into a deployed artifact. Astro 6 removed
`Astro.locals.runtime.env`, so use `astro:env/server` with a secret field, falling
back to `cloudflare:workers`'s `env` if the adapter does not wire it. Confirm which
works during implementation; local development uses `.dev.vars`.

### 3.3 Base layout

`Base.astro` gains `<VisualEditing enabled={visualEditingEnabled} />` before `</body>`,
where `visualEditingEnabled` reads `PUBLIC_SANITY_VISUAL_EDITING_ENABLED`. In the
production build the flag is unset, the component renders nothing, and no JavaScript
is emitted.

It also gains `stegaClean()` around every value that reaches `<head>` — `title`,
`metaDescription`, and the `og:` variants. Invisible stega characters in a `<title>`
are an SEO defect; in preview they would also make the browser tab look corrupt. Body
copy is deliberately *not* cleaned: the stega characters are what make it clickable.

`CharmImage` and `Prose` need no change — `@sanity/image-url` and the Portable Text
renderer both handle stega internally.

### 3.4 `[slug].astro`

The `throw new Error(...)` on a missing page was a build-time guard, unreachable
under `getStaticPaths`. Under SSR an unknown slug is a routine request, so it becomes
a 404 response. Production behaviour is unchanged because the branch never runs there.

### 3.5 Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `PUBLIC_SANITY_VISUAL_EDITING_ENABLED` | preview build | switches perspective, stega, overlays |
| `SANITY_API_READ_TOKEN` | preview Worker secret | Viewer token; reads drafts |
| `SANITY_STUDIO_PREVIEW_ORIGIN` | Studio build | preview origin, defaults to `http://localhost:4321` |

## 4. Studio changes

### 4.1 Presentation tool

`presentationTool({resolve, previewUrl})` joins `structureTool` and `visionTool`.
`previewUrl` is the origin only — no `previewMode` handshake, because the preview
deployment always renders drafts and is gated at the edge instead (§5.2).

`stega.studioUrl` is `https://studio.softmess.de`, the absolute Studio origin, since
the Studio is a separate deployment rather than a route on the site.

### 4.2 Document locations

`resolve.locations` so Structure and Presentation cross-link:

| Type | Locations |
| --- | --- |
| `homePage` | `/` |
| `legalPage` | `/{slug}` |
| `siteSettings` | `/` — labelled "Every page", since header, footer and 404 all read it |

### 4.3 `siteSettings` field groups

Ten flat fields is past the point where a form reads well. Group them: **Brand**
(`brand`, `tagline`, `email`), **Footer** (`instagram`, `instagramHandle`,
`instagramLabel`, `copyright`, `backLabel`), **Not found** (`notFound`), **SEO**
(`seo`). Field definitions, names and validation are unchanged — this is presentation
only, so no schema extraction drift and no regenerated types.

## 5. Deployment

### 5.1 Worker config

`site/wrangler.preview.jsonc`, following Cloudflare's Astro guide:

```jsonc
{
  "name": "softmess-preview",
  "main": "./dist-preview/_worker.js/index.js",
  "assets": {"directory": "./dist-preview", "binding": "ASSETS"},
  "compatibility_flags": ["nodejs_compat"],
  "observability": {"enabled": true},
  "routes": [{"pattern": "preview.softmess.de", "custom_domain": true}]
}
```

`site/wrangler.jsonc` and `studio/wrangler.jsonc` are untouched.

### 5.2 Access gate

The preview Worker renders unpublished content to anyone who reaches it, so it sits
behind a Cloudflare Access policy scoped to the owner's email.

One risk needs settling before the rest of the deployment work: Access must survive
being framed cross-origin by `studio.softmess.de`. If the `CF_Authorization` cookie
is not sent on the iframe subrequest, or Access's login redirect refuses to frame,
Presentation shows a blank or looping iframe. Spike this first, against a
`*.workers.dev` hostname, before DNS and custom domains are set up.

Fallback if it fails: the `@sanity/preview-url-secret` handshake — Presentation calls
an `/api/preview/enable` endpoint with a Studio-issued secret, the Worker validates
it against the Sanity API and sets a `SameSite=None; Secure` cookie; without the
cookie it serves published content. It is known to work inside the iframe, at the
cost of two endpoints and per-request perspective switching we would maintain.

Second fallback, if both prove more trouble than the content is worth: an unlisted
hostname with `noindex`. The drafts in question are landing-page marketing copy.

### 5.3 Secrets and DNS

- `SANITY_API_READ_TOKEN` — new Viewer token from sanity.io/manage, set with
  `wrangler secret put` against `softmess-preview`. For local development it goes in
  the repo-root `.env.local` or in `site/.dev.vars`, depending on how open item 2
  resolves. `*.local` already covers the former; `.gitignore` gains `.dev.vars` and
  `site/dist-preview` either way.
- `preview.softmess.de` — a Cloudflare custom domain. Note the unresolved NXDOMAIN
  problem on `studio.softmess.de`; if it recurs here, `*.workers.dev` is sufficient,
  as the origin is only ever loaded inside the Studio.
- Deployment stays manual `wrangler deploy`, matching the other two Workers. The
  `deploy.yml` sketched in the site design does not exist yet; adding the preview
  Worker to it is that task's problem, not this one's.

## 6. Verification

| Check | Guards |
| --- | --- |
| `astro build --config astro.preview.config.mjs` in `pnpm verify` | the SSR path can't rot behind a passing static build |
| `astro check` | types across both configs |
| Existing fixture build + `dist.test.ts` | rendered markup unchanged by the data-layer swap |
| New assertion in `dist.test.ts`: no `<script>` in production output | the zero-JS goal, now that React is a dependency |
| Manual: edit `homePage.heading` in Presentation, see it change | the feature itself |
| Manual: view source on the production build, no stega characters | the published site stays clean |

Typegen is unaffected — no schema field changes — so the `git diff --exit-code` gate
on `site/src/sanity.types.ts` should stay silent. If it doesn't, something in §4.3
went further than intended.

## 7. Deferred, with reasons

**Drag-to-reorder arrays.** Needs `useOptimistic` and `createDataAttribute`, and the
component holding the array must render on the client. On this site the reorderable
arrays are `homePage.actions` (two buttons) and `homePage.body` (max two paragraphs).
Converting `Header`, `Footer`, `Prose` and the page bodies from `.astro` to `.tsx`,
and swapping `astro-portabletext` for `@portabletext/react`, is not worth reordering
two buttons. Astro islands are per-component, so if this becomes worth doing, one
component becomes an island and the rest stay as they are.

**In-page text editing.** Not a stock feature. Overlays are click-to-edit only;
mutating content from the page requires custom overlay components, which are
React-only and documented as experimental with APIs subject to change.

**Refresh without a full reload.** `VisualEditing` calls `window.location.reload()`
on every Studio change. A custom `refresh` function can replace it, but must be
passed to the React component as a `client:only` island. Revisit if the reload flash
proves annoying in practice.

**A page-builder editing experience.** If the site ever wants many reorderable
blocks and in-place editing, Astro is the wrong substrate and Next.js with
`next-sanity` is where both the canonical path and the features live. That is a
replatform, not an increment, and nothing in this design blocks it.

## 8. Open items

1. Does Cloudflare Access work inside the Presentation iframe? (§5.2 — spike first.)
2. Does `astro:env/server` deliver a Worker secret at runtime under
   `@astrojs/cloudflare@14`, or is `cloudflare:workers` required? (§3.2.)
3. Does `@sanity/client@8` behave correctly under integrations that peer on `^7`?
   (§2.2.)

Each is answerable in minutes during implementation, and each has a stated fallback.
