# softmess.de — design

Date: 2026-08-15
Status: approved pending spec review

Turn the Claude Design mockup (`Softmess.dc.html`) into a production site: content in
Sanity, source in a public GitHub repo, built and deployed to Cloudflare Workers by
GitHub Actions.

## 1. Goals and non-goals

**Goals**

- Reproduce the mockup faithfully at `softmess.de` — home, imprint, privacy.
- Every word and image on the public site editable in Sanity by a non-developer.
- Sanity Studio at `studio.softmess.de`.
- Publishing in Sanity redeploys the site without anyone touching git.
- The public site ships no client-side JavaScript and no third-party requests.

**Non-goals**

- No shop, cart, accounts, analytics, or cookie banner. (`shop.softmess.de` already has
  Cloudflare Email Routing MX records, so a shop may come later — the design should not
  block it, but nothing here builds toward it.)
- No localisation. The site is English with two German legal headings, as the mockup has it.
- No visual editing / Presentation tool. Static builds make the payoff small relative to
  the wiring cost; revisit if editing becomes frequent.

## 2. Source material

`Softmess.dc.html` is a single hash-routed page with three views driven by a
`DCLogic` component. Everything below is derived from it.

| Mockup element | Disposition |
| --- | --- |
| `<x-dc>`, `<sc-if>`, `DCLogic`, `support.js` | Design-canvas runtime. Dropped. |
| `_ds/…/_ds_bundle.js` | Design-canvas tooling. Dropped. |
| `_ds/…/styles.css` ("Organic" kit) | Overridden almost entirely by the page's own `:root`. Only `--space-*`, `--shadow-*` and `.washed` survive, and those move into the Tailwind theme. |
| Inline `style="…"` attributes | Ported to Tailwind classes. |
| `style-hover` / `style-active` attributes | Canvas-only syntax. Become `hover:` / `active:` variants. |
| Hash routes `#/imprint`, `#/privacy` | Real routes `/imprint`, `/privacy`. |
| Google Fonts `<link>` | Replaced with self-hosted `@fontsource` — see §7. |
| `showEmail` prop | Replaced by the `actions[]` model — see §5.3. |
| `heroCharm: "red" \| "green"` prop | Replaced by a single `charm` image field — see §5.3. |

## 3. Architecture

Two Cloudflare Workers, one repo, one workflow. **Neither Worker has any code** — both
are pure static-asset Workers, so there is no request-time logic to reason about or test.

```
                  ┌─────────────────────────────────────────┐
   git push main  │  GitHub Actions                         │
  ───────────────>│    verify → build → wrangler deploy ×2   │
                  └───────────────┬─────────────────────────┘
   Sanity publish                 │
  ───webhook──────────────────────┘        ┌──────────────────────────┐
     (repository_dispatch)                 │  softmess         Worker │  softmess.de
                                           │  assets: site/dist       │  www.softmess.de
   ┌──────────┐   build-time GROQ          └──────────────────────────┘
   │  Sanity  │<───────────────────────────┐
   │ 85i3osnk │                            │  ┌──────────────────────────┐
   └─────┬────┘                            └──│  softmess-studio  Worker │  studio.softmess.de
         │  browser (editor) ────────────────>│  assets: studio/dist     │
         └────────────────────────────────────└──────────────────────────┘
```

Requests to `softmess.de` never touch Sanity. If Sanity is down, the site is unaffected;
only publishing stops working.

### 3.1 Why static, not runtime

Chosen: build-time fetch, webhook-triggered rebuild. A landing page whose content changes
a few times a year does not justify a runtime dependency, cache invalidation, or the
latency of a Sanity round-trip on the request path. The cost is ~40s between hitting
Publish and the change being live, which is acceptable.

### 3.2 Why two Workers

The Studio is a large React SPA needing `single-page-application` 404 handling; the site
is a three-page static build needing `404-page` handling. Splitting them keeps both
configs trivial, lets either deploy independently, and means the Studio bundle can never
be served from the marketing hostname.

## 4. Repository layout

`create-sanity` bootstrapped the Studio at the repo root. That gets relocated with
`git mv` (preserving history) into a pnpm workspace:

```
.
├─ .github/workflows/deploy.yml
├─ .env                     projectId + dataset — committed, no secrets
├─ .env.local               tokens — gitignored
├─ docs/superpowers/specs/
├─ package.json             root: workspace scripts only
├─ pnpm-workspace.yaml      packages: [site, studio]
├─ seed/
│  ├─ images/               charm-red.jpg, charm-green.jpg (moved from static/)
│  └─ seed.ts               one-shot content seeding, see §8
├─ site/
│  ├─ astro.config.mjs
│  ├─ package.json
│  ├─ wrangler.jsonc
│  ├─ public/
│  ├─ test/
│  │  ├─ fixtures/*.json
│  │  └─ dist.test.ts
│  └─ src/
│     ├─ layouts/Base.astro
│     ├─ components/{Header,Footer,CharmImage,Prose}.astro
│     ├─ pages/{index,[slug],404}.astro
│     ├─ lib/{sanity.ts,image.ts,content.ts}
│     ├─ sanity.types.ts    generated by TypeGen, committed
│     └─ styles/theme.css
└─ studio/
   ├─ package.json          the bootstrapped one, moved
   ├─ sanity.config.ts
   ├─ sanity.cli.ts
   ├─ wrangler.jsonc
   ├─ schema.json           generated by extract, gitignored
   ├─ structure.ts
   └─ schemaTypes/{index,siteSettings,homePage,legalPage}.ts
```

`static/charm-*.jpg` moves to `seed/images/`. A Sanity Studio serves `static/` publicly,
and once the images live in Sanity as assets there is no reason to ship 1 MB of duplicates
from the Studio origin.

### 4.1 Root scripts

```
pnpm dev            → studio dev server + astro dev, concurrently
pnpm typegen        → sanity schemas extract --force && sanity typegen generate
pnpm verify         → pnpm typegen
                      && git diff --exit-code site/src/sanity.types.ts
                      && astro check && build:fixtures && vitest
pnpm build:site     → astro build            (needs SANITY_API_TOKEN)
pnpm build:studio   → sanity build
```

## 5. Content model

Four document types. Two singletons pinned to fixed IDs via Studio Structure (`S.document()
.documentId('siteSettings')`), per Sanity's singleton pattern — there is no `singleton: true`
schema option. Legal pages are ordinary documents with generated IDs, keyed by slug.

### 5.1 `siteSettings` (singleton, id `siteSettings`)

| Field | Type | Notes |
| --- | --- | --- |
| `brand` | string, required | `softmess` — wordmark and `<title>` suffix |
| `tagline` | string | `project` — the header eyebrow |
| `email` | string, `rule.email()` | `hi@softmess.de` — used in header CTA, imprint, privacy |
| `instagram` | url, `rule.uri({scheme:['https']})` | profile URL |
| `instagramHandle` | string | `@softmess.project` — display text in imprint and footer |
| `copyright` | string | `© 2026 softmess project` |
| `seo` | object `{title, description, ogImage}` | nested object, not a reference — document-specific |

### 5.2 `legalPage` (2 documents)

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string, required | `imprint` |
| `slug` | slug, required | validated `^[a-z0-9-]+$`, unique |
| `kicker` | string | `Angaben gemäß § 5 DDG` |
| `body` | array of `block` | Portable Text; `h2`, normal, strong, em, link only. The link annotation must allow `mailto:` alongside `http`/`https` — the mockup's legal copy links `hi@softmess.de` inline. |

Only `h2` and paragraphs are enabled as block styles — the mockup's legal pages use nothing
else, and an unconstrained editor invites drift from the design.

### 5.3 `homePage` (singleton, id `homePage`)

| Field | Type | Notes |
| --- | --- | --- |
| `heading` | string, required | `softmess` |
| `statement` | string, required | `follow the white rabbit.` |
| `body` | array of string, max 2 | the two hero paragraphs; the first renders in ink, the rest muted, matching the mockup — a rendering convention, not a stored field |
| `charm` | image, `hotspot: true`, required, with `alt` | the hero photo |
| `actions` | array of `action` object | the CTA buttons |

`action` object: `{ label: string (required), href: url (required) }`.

**Two deliberate departures from the mockup's props**, both applying Sanity's
"model what things are, not what they look like" rule:

- **`heroCharm: "red" | "green"` → a `charm` image field.** The enum existed so the
  designer could flip between two photos on the canvas. In a CMS the equivalent is simply
  choosing the image — which also gets hotspot cropping and required alt text. An enum of
  two hardcoded filenames would fail the "would this field still make sense after a
  redesign?" test.
- **`showEmail: boolean` → the `actions[]` array.** A boolean that hides one specific
  button is a presentation flag. An array of `{label, href}` expresses the same thing as
  data: to hide the email button, delete the action. It also lets Dorina add a third link
  later without a schema change. The first action renders as the primary (filled) button
  and the rest as secondary (outlined) — a rendering convention, not a stored field.

Note `siteSettings.email` stays regardless, because the imprint and privacy pages
reference it independently of the hero button.

### 5.4 Studio structure

```
Content
├─ Site settings        singleton → siteSettings
├─ Home page            singleton → homePage
├─ ─────────
└─ Legal pages          documentTypeList → legalPage
```

Singleton types are filtered out of `S.documentTypeListItems()` so they cannot be
duplicated. Every type gets a `@sanity/icons` icon, imported from its **subpath**
(`@sanity/icons/Cog`) — root named exports were removed in v5 and fail at bundle time
while type-checking clean.

## 6. Data flow and types

Queries live in `site/src/lib/content.ts`, each wrapped in `defineQuery` with a unique
uppercase name so TypeGen can find and type them.

```
SITE_SETTINGS_QUERY   *[_id == "siteSettings"][0]{…}
HOME_PAGE_QUERY       *[_id == "homePage"][0]{…, charm{…, asset->{…}}}
LEGAL_PAGE_SLUGS_QUERY  *[_type == "legalPage" && defined(slug.current)]{"params":{"slug":slug.current}}
LEGAL_PAGE_QUERY      *[_type == "legalPage" && slug.current == $slug][0]{…}
```

Singletons are fetched by `_id`, not `_type` — the fixed ID is an index lookup.

TypeGen runs from the Studio package with monorepo paths, writing into the site:

```ts
// studio/sanity.cli.ts
typegen: {
  enabled: true,
  path: '../site/src/**/*.{ts,astro}',
  schema: 'schema.json',
  generates: '../site/src/sanity.types.ts',
}
```

`site/src/sanity.types.ts` is **committed** so the site type-checks after a plain
`git clone` and CI needs no schema extraction step. `pnpm verify` regenerates and fails if
the result differs from the committed file, so it cannot drift.

`getStaticPaths()` in `[slug].astro` is hoisted into a separate module context by Astro —
module-scope constants are not visible inside it. Queries used there are imported from
`content.ts`, never declared in the page frontmatter.

Images are rendered via `@sanity/image-url` against Sanity's image CDN, emitting a
`srcset` at 1x/2x with `fm=webp`. No local image pipeline, no `astro:assets`.

## 7. Styling

Tailwind v4 via `@tailwindcss/vite`, CSS-first config. The mockup's tokens become the
Tailwind theme, so markup reads in the design's own vocabulary instead of arbitrary values:

```css
@theme {
  --color-bg: #f5f2ea;          --color-surface: #ece8dd;
  --color-ink: #17161c;         --color-muted: #6e6b64;
  --color-accent: #3a1fd8;      --color-accent-600: #2f18b8;
  --color-accent-700: #2a15a4;  --color-accent-800: #221082;
  --color-accent-200: #ded9f7;  --color-sand-200: #e6e3d8;

  --font-display: 'Bagel Fat One', system-ui, sans-serif;
  --font-sans: 'Outfit', system-ui, sans-serif;

  --spacing: 4.4px;   /* the Organic base — n-1…n-8 land exactly on 4.4…35.2px */

  --text-hero: clamp(52px, 10vw, 120px);
  --text-statement: clamp(22px, 3.4vw, 34px);
  --text-page-title: clamp(36px, 6vw, 56px);

  --animate-drift: drift 14s ease-in-out infinite;
}
```

`--spacing: 4.4px` is what makes this an adaptation rather than a reskin: Tailwind's whole
numeric scale (`p-4`, `gap-6`, `mb-8`) resolves onto the Organic kit's existing steps, so
the two systems agree by construction instead of by lookup table.

Three things Tailwind should not express as utilities, kept as `@utility` definitions:
`charm-blob` (the asymmetric `999px 999px 260px 260px / 999px 999px 300px 300px` radius),
`washed` (the photo filter), and the `drift` keyframes.

`--color-divider: color-mix(in srgb, #17161c 18%, transparent)` is dropped — Tailwind's
opacity modifier (`border-ink/18`) is the native expression of it.

**Fonts are self-hosted** via `@fontsource/outfit` (weights 300/400/500/700) and
`@fontsource/bagel-fat-one` (400 — a display face with a single weight), imported in
`Base.astro` so Astro bundles and fingerprints the woff2 files. This is not a
preference: the privacy policy in the mockup states *"fonts and images are served from this
site's own server."* Loading them from `fonts.googleapis.com` would make a published GDPR
statement on an imprinted German site false, and would leak visitor IPs to Google.

## 8. Seeding

`seed/seed.ts` runs once, locally, against the Sanity CLI's admin token (`sanity exec`):

1. Upload `seed/images/charm-red.jpg` and `charm-green.jpg` as image assets.
2. `createIfNotExists` the `siteSettings` and `homePage` singletons with the mockup's copy
   and `charm` pointing at the red asset.
3. `createIfNotExists` two `legalPage` documents, converting the mockup's `<h2>`/`<p>`
   markup to Portable Text blocks.

`createIfNotExists`, not `createOrReplace`: re-running the script must never overwrite
edits made in the Studio.

The imprint's `[street and number]` / `[postcode and city]` placeholders are seeded
verbatim unless a real address is supplied. §11 covers the consequence.

## 9. Deployment

### 9.1 Workers

```jsonc
// site/wrangler.jsonc
{
  "name": "softmess",
  "compatibility_date": "2026-08-15",
  "assets": { "directory": "./dist", "not_found_handling": "404-page" },
  "routes": [
    { "pattern": "softmess.de", "custom_domain": true },
    { "pattern": "www.softmess.de", "custom_domain": true }
  ]
}
```

```jsonc
// studio/wrangler.jsonc
{
  "name": "softmess-studio",
  "compatibility_date": "2026-08-15",
  "assets": { "directory": "./dist", "not_found_handling": "single-page-application" },
  "routes": [{ "pattern": "studio.softmess.de", "custom_domain": true }]
}
```

`custom_domain: true` makes wrangler provision the proxied DNS record and TLS cert. The
zone `softmess.de` (`7ace224a…`) currently has no A/CNAME for apex, `www`, or `studio`, so
there is nothing to conflict with; the existing iCloud MX and TXT records are untouched.

**`autoUpdates` is set to `false`** in `sanity.cli.ts` (currently `true` from the
bootstrap). Auto-updates make `sanity build` emit an import map pointing at Sanity's CDN so
a hosted Studio can self-update. For a Studio we deploy ourselves through CI that trades a
deterministic, self-contained bundle for a runtime dependency on a third-party origin, with
no benefit — CI already redeploys on every push.

### 9.2 Workflow

```yaml
on:
  push:              { branches: [main] }
  pull_request:
  repository_dispatch: { types: [sanity-publish] }
  workflow_dispatch:
```

| Job | Runs when | Steps |
| --- | --- | --- |
| `verify` | always | install → `pnpm typegen` + diff check → `astro check` → fixture build → vitest |
| `deploy-site` | `main` push, dispatch, manual | real `astro build` → `wrangler deploy` |
| `deploy-studio` | `main` push, manual — **not** on `sanity-publish` | `sanity build` → `wrangler deploy` |

`deploy-studio` is excluded from content-publish rebuilds because the Studio bundle only
changes when the schema or its dependencies change, never when content does.

Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SANITY_API_TOKEN`. The Sanity
token is deliberately the read-only one — a build only ever reads.

### 9.3 Publish webhook

Created against the Sanity management API using the CLI's admin credentials:

- URL `https://api.github.com/repos/softmess-project/site/dispatches`, POST
- Headers: `Authorization: Bearer <PAT>`, `Accept: application/vnd.github+json`
- Projection: `{"event_type": "sanity-publish"}`
- Filter: `_type in ["siteSettings", "homePage", "legalPage"]`
- Published documents only; on create, update and delete

## 10. Testing

Success criterion: **`pnpm verify` passes**, and it must be runnable with no network and no
secrets so it works on a fresh clone and on fork PRs.

That rules out testing against a real Sanity build, so `site/src/lib/sanity.ts` switches
source on `SANITY_FIXTURES=1`, reading `site/test/fixtures/*.json` instead of fetching. The
fixtures are checked in and shaped by the generated types, so a schema change that breaks
them fails `astro check`.

Tests are written first, and assert over the built `dist/` with `linkedom` — no browser,
no dev server:

1. `/index.html`, `/imprint/index.html`, `/privacy/index.html` all exist.
2. Each has the expected `<title>` and a `<meta name="description">`.
3. Home renders `heading`, `statement`, both body paragraphs, and one `<img>` whose `src`
   is a `cdn.sanity.io` URL with a `srcset`.
4. Home renders one `<a>` per `actions[]` entry, first one carrying the primary classes;
   a fixture with a single action produces exactly one button.
5. Imprint and privacy render their Portable Text `<h2>`s and paragraphs, and the
   `mailto:` link.
6. No `[`-bracketed placeholder string survives into any built page.
7. No built page loads a **subresource** — `<script src>`, `<link href>`, `<img src>`,
   `@font-face src`, `srcset` — from any origin other than same-origin or
   `cdn.sanity.io`. `fonts.googleapis.com` and `fonts.gstatic.com` in particular must be
   absent. Outbound `<a href>` links (Instagram, `mailto:`) are explicitly exempt: they
   send nothing until the visitor clicks, which is precisely what the privacy policy says.
8. No `<script>` tag is emitted by the site build.

Assertions 6–8 are the ones worth having: they encode promises the site makes in its own
legal text, which is exactly the kind of thing that rots silently.

## 11. Open items requiring the owner

1. **Imprint address.** `[street and number]` and `[postcode and city]` are placeholders.
   A German site with a `§ 5 DDG` imprint that carries no address is not compliant. Test 6
   fails while they are present, so **the site cannot deploy until they are filled** —
   either supplied now and seeded, or entered in the Studio before first publish. This is
   intentional: shipping a fake imprint should be hard.
2. **GitHub PAT scope.** `GITHUB_TOKEN` in `.env.local` is a fine-grained PAT. It needs
   `Contents: read and write` on `softmess-project/site` to fire `repository_dispatch`.
   To be verified before wiring the webhook.
3. **Cloudflare token scope.** Provisioning custom domains needs `Zone:DNS:Edit` and
   `Workers Routes:Edit` on the `softmess.de` zone. To be verified; the fallback is
   creating the three DNS records directly over the API.
4. **`git remote`.** Not configured locally. Points at
   `https://github.com/softmess-project/site` (public, empty, default branch `main`).

## 12. Decision log

| Decision | Rejected alternative | Why |
| --- | --- | --- |
| Static build + webhook | Worker fetches Sanity per request | No runtime dependency; content changes are rare |
| Two asset-only Workers | One Worker routing by hostname | No Worker code at all; independent deploys; Studio can't leak onto the marketing host |
| Workers static assets | Cloudflare Pages | Pages is the legacy path for new projects |
| `studio.softmess.de` | `softmess.de/studio` | Removes `@sanity/astro`, `@astrojs/react` and the SPA rewrite; site ships zero JS |
| pnpm workspace | Single root package.json | `create-sanity` already created a full package at root; two build targets with disjoint dep trees |
| Real routes | Hash routing | SEO, shareable URLs, free with SSG |
| Self-hosted fonts | Google Fonts CDN | The site's own privacy policy claims self-hosting |
| `actions[]` array | `showEmail` boolean | Data over presentation; extensible without schema change |
| `charm` image field | `heroCharm` red/green enum | Canvas affordance, not a content concept |
| Committed `sanity.types.ts` | Generate in CI | Fresh clone type-checks; drift caught by `pnpm verify` |
| Fixture-based tests | Test the real build | Runs without secrets or network; deterministic |
| `autoUpdates: false` | `true` (bootstrap default) | Self-contained bundle; no third-party origin at runtime |
