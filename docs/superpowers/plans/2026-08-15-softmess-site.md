# softmess.de Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `Softmess.dc.html` mockup as a production site at `softmess.de`, with all content editable in Sanity and deployed to Cloudflare Workers by GitHub Actions.

**Architecture:** A pnpm workspace with two packages. `site/` is an Astro static build that fetches Sanity at build time and emits three HTML pages with zero client JavaScript. `studio/` is the Sanity Studio. Each deploys to its own Cloudflare Worker as pure static assets — neither Worker has any code. Publishing in Sanity fires a webhook at GitHub, which rebuilds and redeploys the site.

**Tech Stack:** Astro 7.2.2, Tailwind CSS 4.3.3 (`@tailwindcss/vite`), Sanity 6.9.2, `@sanity/client` 8.0.0, `astro-portabletext` 0.13.0, Vitest 4.1.10 + linkedom 0.18.13, Wrangler 4.x, pnpm 11.9.0, Node 24.

**Spec:** `docs/superpowers/specs/2026-08-15-softmess-site-design.md`

## Global Constraints

- **Node ≥ 22.12** (Astro 7 engine requirement). CI pins Node 24.
- **pnpm 11** blocks postinstall scripts by default. `pnpm-workspace.yaml` must declare `onlyBuiltDependencies: [esbuild]`, or every install fails with "Run pnpm approve-builds".
- **Sanity CLI subcommand is `schemas` (plural)**: `sanity schemas extract`, not `sanity schema extract`.
- **`@sanity/icons` must be imported from subpaths** — `import {CogIcon} from '@sanity/icons/Cog'`. Root named exports were removed in v5; they type-check clean and then fail at bundle time.
- **Studio code style is set by the bootstrap's Prettier config** and is not negotiable: no semicolons, single quotes, no bracket spacing, `printWidth: 100`. Match it in every file under `studio/`.
- **Secrets live only in `.env.local`** (gitignored). `.env` holds `SANITY_PROJECT_ID` / `SANITY_DATASET` and IS committed. The repo is public — never move a token into `.env`, a workflow file, or `wrangler.jsonc`.
- **Sanity project:** `projectId` `85i3osnk`, dataset `production`. Sanity `apiVersion` is `'2026-08-15'` everywhere.
- **Cloudflare:** account `e0542a0d4f2b1a7df8aa4600e792dbe3`, zone `softmess.de` (`7ace224ab1450f917eeeb48863ae630f`).
- **GitHub:** `softmess-project/site`, public, default branch `main`.
- **The site build must emit no `<script>` tag and no third-party subresource.** The site's own privacy policy says so. Tests enforce it.
- **Copy is lowercase** in the mockup (`softmess`, `follow the white rabbit.`, `imprint`, `privacy`). Reproduce it verbatim; do not sentence-case it.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `pnpm-workspace.yaml` | Declares `site` + `studio` packages, `onlyBuiltDependencies` |
| `package.json` | Root: workspace-level scripts only, no dependencies |
| `studio/schemaTypes/*.ts` | One file per document type, plus a barrel `index.ts` |
| `studio/structure.ts` | Singleton pinning + list filtering |
| `studio/sanity.cli.ts` | TypeGen config writing into `site/`, `autoUpdates: false` |
| `studio/wrangler.jsonc` | `softmess-studio` Worker, SPA 404 handling |
| `site/astro.config.mjs` | Tailwind plugin, env loading from repo root |
| `site/src/lib/sanity.ts` | The `@sanity/client` instance. Nothing else. |
| `site/src/lib/content.ts` | All GROQ queries + the fixture/live switch. The only module pages import for data. |
| `site/src/lib/image.ts` | `urlFor()` + `srcSetFor()` against Sanity's image CDN |
| `site/src/styles/theme.css` | Tailwind theme: the mockup's tokens, `@utility`, keyframes |
| `site/src/layouts/Base.astro` | `<head>`, fonts, SEO meta, page chrome, decorative blobs |
| `site/src/components/*.astro` | `Header`, `Footer`, `CharmImage`, `Prose` |
| `site/src/pages/*.astro` | `index`, `[slug]`, `404` |
| `site/test/fixtures/*.json` | Typed content fixtures for offline builds |
| `site/test/dist.test.ts` | Assertions over built HTML |
| `site/wrangler.jsonc` | `softmess` Worker, 404-page handling |
| `seed/seed.ts` | One-shot Sanity content seeding |
| `.github/workflows/deploy.yml` | verify → deploy-site → deploy-studio |

---

## Task 1: Restructure into a pnpm workspace

**Files:**
- Move: `package.json`, `sanity.config.ts`, `sanity.cli.ts`, `schemaTypes/`, `eslint.config.mjs`, `tsconfig.json` → `studio/`
- Move: `static/charm-red.jpg`, `static/charm-green.jpg` → `seed/images/`
- Delete: `static/` (including `.gitkeep`), `README.md` (the Sanity boilerplate one)
- Create: `package.json` (new root), `site/package.json`, `site/tsconfig.json`, `README.md`
- Modify: `pnpm-workspace.yaml`, `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: workspace packages named `studio` and `site`; root scripts `dev`, `typegen`, `verify`, `build:site`, `build:studio`

- [ ] **Step 1: Move the bootstrapped Studio into `studio/` with history preserved**

```bash
mkdir -p studio seed/images
git mv package.json sanity.config.ts sanity.cli.ts schemaTypes eslint.config.mjs tsconfig.json studio/
git mv static/charm-red.jpg static/charm-green.jpg seed/images/
git rm -q static/.gitkeep
git rm -q README.md
rmdir static 2>/dev/null || true
```

- [ ] **Step 2: Write the workspace manifest**

The `allowBuilds:` stub that `create-sanity` left behind is not valid pnpm config and must be replaced. Replace `pnpm-workspace.yaml` entirely:

```yaml
packages:
  - site
  - studio

onlyBuiltDependencies:
  - esbuild
```

- [ ] **Step 3: Write the root `package.json`**

No dependencies at the root — it only orchestrates.

```json
{
  "name": "softmess",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -n studio,site -c magenta,blue \"pnpm --filter studio dev\" \"pnpm --filter site dev\"",
    "typegen": "pnpm --filter studio typegen",
    "build:site": "pnpm --filter site build",
    "build:studio": "pnpm --filter studio build",
    "verify": "pnpm typegen && git diff --exit-code site/src/sanity.types.ts && pnpm --filter site check && pnpm --filter site test"
  },
  "devDependencies": {
    "concurrently": "^10.0.5"
  }
}
```

- [ ] **Step 4: Write `site/package.json`**

```json
{
  "name": "site",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "build:fixtures": "SANITY_FIXTURES=1 astro build --outDir dist-fixtures",
    "check": "astro check",
    "test": "pnpm build:fixtures && vitest run"
  },
  "dependencies": {
    "@sanity/client": "^8.0.0",
    "@sanity/image-url": "^2.1.1",
    "astro": "^7.2.2",
    "astro-portabletext": "^0.13.0",
    "groq": "^6.9.2",
    "@fontsource/bagel-fat-one": "^5.3.0",
    "@fontsource/outfit": "^5.3.0"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.4",
    "@tailwindcss/vite": "^4.3.3",
    "tailwindcss": "^4.3.3",
    "typescript": "^5.8",
    "vitest": "^4.1.10",
    "linkedom": "^0.18.13",
    "wrangler": "^4.123.0"
  }
}
```

`build:fixtures` writes to `dist-fixtures/` so a fixture build can never be mistaken for a deployable one.

- [ ] **Step 5: Write `site/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist", "dist-fixtures"]
}
```

- [ ] **Step 6: Extend `.gitignore`**

Append:

```gitignore
# Astro
site/dist
site/dist-fixtures
site/.astro

# Sanity schema extract (generated)
studio/schema.json

# Wrangler
.wrangler
```

- [ ] **Step 7: Write a real `README.md`**

```markdown
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
```

- [ ] **Step 8: Install and verify the workspace resolves**

Run: `pnpm install`
Expected: succeeds with no "approve-builds" prompt, creates `site/node_modules` and `studio/node_modules`.

- [ ] **Step 9: Verify the Studio still builds from its new location**

Run: `pnpm build:studio`
Expected: PASS — writes `studio/dist/index.html`. (It has no schema types yet; an empty Studio still builds.)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: restructure into site + studio pnpm workspace"
```

---

## Task 2: Sanity schema, structure, and TypeGen

**Files:**
- Create: `studio/schemaTypes/{siteSettings,homePage,legalPage,action}.ts`, `studio/structure.ts`
- Modify: `studio/schemaTypes/index.ts`, `studio/sanity.config.ts`, `studio/sanity.cli.ts`, `studio/package.json`

**Interfaces:**
- Consumes: workspace layout from Task 1
- Produces: document types `siteSettings`, `homePage`, `legalPage`; object type `action`; generated `site/src/sanity.types.ts` exporting `SiteSettings`, `HomePage`, `LegalPage`, `Action`

- [ ] **Step 1: Write `studio/schemaTypes/action.ts`**

```ts
import {defineField, defineType} from 'sanity'
import {LinkIcon} from '@sanity/icons/Link'

export const action = defineType({
  name: 'action',
  title: 'Action',
  type: 'object',
  icon: LinkIcon,
  fields: [
    defineField({
      name: 'label',
      type: 'string',
      description: 'Button text, e.g. "it all happens on instagram"',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'href',
      type: 'url',
      title: 'Link',
      validation: (rule) =>
        rule
          .required()
          .uri({scheme: ['http', 'https', 'mailto']})
          .error('Must be an http(s) or mailto: link'),
    }),
  ],
  preview: {
    select: {title: 'label', subtitle: 'href'},
  },
})
```

- [ ] **Step 2: Write `studio/schemaTypes/siteSettings.ts`**

```ts
import {defineField, defineType} from 'sanity'
import {CogIcon} from '@sanity/icons/Cog'

export const siteSettings = defineType({
  name: 'siteSettings',
  title: 'Site settings',
  type: 'document',
  icon: CogIcon,
  fields: [
    defineField({name: 'brand', type: 'string', validation: (rule) => rule.required()}),
    defineField({
      name: 'tagline',
      type: 'string',
      description: 'The small word beside the wordmark, e.g. "project"',
    }),
    defineField({name: 'email', type: 'string', validation: (rule) => rule.required().email()}),
    defineField({
      name: 'instagram',
      type: 'url',
      validation: (rule) => rule.required().uri({scheme: ['https']}),
    }),
    defineField({
      name: 'instagramHandle',
      type: 'string',
      description: 'Display text, e.g. "@softmess.project"',
    }),
    defineField({name: 'copyright', type: 'string'}),
    defineField({
      name: 'seo',
      type: 'object',
      options: {collapsible: true, collapsed: false},
      fields: [
        defineField({name: 'title', type: 'string'}),
        defineField({
          name: 'description',
          type: 'text',
          rows: 3,
          validation: (rule) => rule.max(160).warning('Keep under 160 characters'),
        }),
        defineField({name: 'ogImage', type: 'image'}),
      ],
    }),
  ],
  preview: {
    prepare: () => ({title: 'Site settings'}),
  },
})
```

- [ ] **Step 3: Write `studio/schemaTypes/homePage.ts`**

```ts
import {defineArrayMember, defineField, defineType} from 'sanity'
import {HomeIcon} from '@sanity/icons/Home'

export const homePage = defineType({
  name: 'homePage',
  title: 'Home page',
  type: 'document',
  icon: HomeIcon,
  fields: [
    defineField({name: 'heading', type: 'string', validation: (rule) => rule.required()}),
    defineField({
      name: 'statement',
      type: 'string',
      description: 'The line under the wordmark, e.g. "follow the white rabbit."',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'body',
      type: 'array',
      description: 'Up to two paragraphs. The first is emphasised, the rest muted.',
      of: [defineArrayMember({type: 'text', rows: 3})],
      validation: (rule) => rule.max(2),
    }),
    defineField({
      name: 'charm',
      type: 'image',
      options: {hotspot: true},
      validation: (rule) => rule.required(),
      fields: [
        defineField({
          name: 'alt',
          type: 'string',
          title: 'Alt text',
          validation: (rule) => rule.required(),
        }),
      ],
    }),
    defineField({
      name: 'actions',
      type: 'array',
      description: 'Buttons under the intro. The first renders filled, the rest outlined.',
      of: [defineArrayMember({type: 'action'})],
    }),
  ],
  preview: {
    prepare: () => ({title: 'Home page'}),
  },
})
```

- [ ] **Step 4: Write `studio/schemaTypes/legalPage.ts`**

```ts
import {defineArrayMember, defineField, defineType} from 'sanity'
import {DocumentTextIcon} from '@sanity/icons/DocumentText'

export const legalPage = defineType({
  name: 'legalPage',
  title: 'Legal page',
  type: 'document',
  icon: DocumentTextIcon,
  fields: [
    defineField({name: 'title', type: 'string', validation: (rule) => rule.required()}),
    defineField({
      name: 'slug',
      type: 'slug',
      options: {source: 'title', maxLength: 96},
      validation: (rule) =>
        rule.required().custom((slug) => {
          if (!slug?.current) return 'Required'
          if (!/^[a-z0-9-]+$/.test(slug.current)) return 'Lowercase letters, numbers and hyphens only'
          return true
        }),
    }),
    defineField({
      name: 'kicker',
      type: 'string',
      description: 'Small uppercase line under the title, e.g. "Angaben gemäß § 5 DDG"',
    }),
    defineField({
      name: 'body',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'block',
          styles: [
            {title: 'Paragraph', value: 'normal'},
            {title: 'Heading', value: 'h2'},
          ],
          lists: [],
          marks: {
            decorators: [
              {title: 'Bold', value: 'strong'},
              {title: 'Italic', value: 'em'},
            ],
            annotations: [
              defineArrayMember({
                name: 'link',
                type: 'object',
                title: 'Link',
                fields: [
                  defineField({
                    name: 'href',
                    type: 'url',
                    validation: (rule) =>
                      rule.required().uri({scheme: ['http', 'https', 'mailto']}),
                  }),
                ],
              }),
            ],
          },
        }),
      ],
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: {title: 'title', subtitle: 'slug.current'},
  },
})
```

`lists: []` and the two-style whitelist are deliberate — the mockup's legal pages use only `h2` and paragraphs, and an unconstrained editor invites drift from the design.

- [ ] **Step 5: Rewrite `studio/schemaTypes/index.ts`**

```ts
import {action} from './action'
import {homePage} from './homePage'
import {legalPage} from './legalPage'
import {siteSettings} from './siteSettings'

export const schemaTypes = [siteSettings, homePage, legalPage, action]
```

- [ ] **Step 6: Write `studio/structure.ts`**

```ts
import type {StructureResolver} from 'sanity/structure'
import {CogIcon} from '@sanity/icons/Cog'
import {HomeIcon} from '@sanity/icons/Home'

const SINGLETONS = ['siteSettings', 'homePage']

export const structure: StructureResolver = (S) =>
  S.list()
    .title('Content')
    .items([
      S.listItem()
        .title('Site settings')
        .icon(CogIcon)
        .child(S.document().schemaType('siteSettings').documentId('siteSettings')),
      S.listItem()
        .title('Home page')
        .icon(HomeIcon)
        .child(S.document().schemaType('homePage').documentId('homePage')),
      S.divider(),
      ...S.documentTypeListItems().filter(
        (item) => !SINGLETONS.includes(item.getId() as string),
      ),
    ])
```

`documentId` equal to the type name is what makes these singletons — there is no `singleton: true` schema option. Filtering `SINGLETONS` out of the generic list prevents editors creating a second copy.

- [ ] **Step 7: Rewrite `studio/sanity.config.ts`**

```ts
import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'
import {structure} from './structure'

export default defineConfig({
  name: 'default',
  title: 'Softmess',

  projectId: '85i3osnk',
  dataset: 'production',

  plugins: [structureTool({structure}), visionTool()],

  schema: {
    types: schemaTypes,
    templates: (templates) =>
      templates.filter(({schemaType}) => !['siteSettings', 'homePage'].includes(schemaType)),
  },
})
```

The `templates` filter removes singletons from the global "create new" menu — the structure filter alone does not.

- [ ] **Step 8: Rewrite `studio/sanity.cli.ts`**

```ts
import {defineCliConfig} from 'sanity/cli'

export default defineCliConfig({
  api: {
    projectId: '85i3osnk',
    dataset: 'production',
  },
  deployment: {
    // We self-host the Studio on Cloudflare and redeploy it from CI on every
    // push. Auto-updates would swap that deterministic bundle for a runtime
    // import map pointing at Sanity's CDN, gaining nothing.
    autoUpdates: false,
  },
  typegen: {
    enabled: true,
    path: '../site/src/**/*.{ts,astro}',
    schema: 'schema.json',
    generates: '../site/src/sanity.types.ts',
  },
})
```

- [ ] **Step 9: Add the Studio's typegen script and icons dependency**

In `studio/package.json`, add to `scripts`:

```json
"typegen": "sanity schemas extract --force && sanity typegen generate"
```

Then: `pnpm --filter studio add @sanity/icons@^5.2.1`

- [ ] **Step 10: Validate the schema**

Run: `pnpm --filter studio exec sanity schemas validate`
Expected: PASS with no errors. If it reports an unknown type `action`, the barrel in Step 5 is missing it.

- [ ] **Step 11: Generate types and confirm the output**

Run: `pnpm typegen`
Expected: writes `site/src/sanity.types.ts`. Confirm it exports `SiteSettings`, `HomePage`, `LegalPage`, `Action`:

```bash
grep -E "^export type (SiteSettings|HomePage|LegalPage|Action) " site/src/sanity.types.ts
```

Expected: four matching lines. TypeGen finds no queries yet — that warning is expected and harmless until Task 3.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(studio): add content schema, singleton structure, and typegen"
```

---

## Task 3: Content layer with a fixture-backed offline mode

This task is where TDD starts. The content layer is the only place data enters the site, so it is the only place worth unit-testing directly.

**Files:**
- Create: `site/src/lib/sanity.ts`, `site/src/lib/content.ts`, `site/src/lib/image.ts`
- Create: `site/test/fixtures/{siteSettings,homePage,legalPages}.json`
- Create: `site/test/content.test.ts`, `site/vitest.config.ts`
- Create: `site/astro.config.mjs`

**Interfaces:**
- Consumes: `site/src/sanity.types.ts` from Task 2
- Produces, all exported from `site/src/lib/content.ts`:
  - types `SiteSettings`, `HomePage`, `LegalPage` — **query-result** aliases, not raw
    document types. A projection returns a subset of a document, so every later task
    imports these from `../lib/content`, never from `../sanity.types`.
  - `getSiteSettings(): Promise<SiteSettings>`
  - `getHomePage(): Promise<HomePage>`
  - `getLegalPageSlugs(): Promise<string[]>`
  - `getLegalPage(slug: string): Promise<LegalPage | null>`
- Produces from `site/src/lib/image.ts`: `urlFor(source)`, `srcSetFor(source, width): string`

- [ ] **Step 1: Write `site/astro.config.mjs`**

Vite resolves `.env` files relative to the Astro project root (`site/`), but ours live at the repo root. `loadEnv` with an explicit dir fixes that. Crucially, real process env (GitHub Actions secrets) must win over file values, hence `??=`.

```js
import {defineConfig} from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import {loadEnv} from 'vite'

// Load the repo-root .env / .env.local into process.env without clobbering
// anything CI already set.
const fileEnv = loadEnv(process.env.NODE_ENV ?? 'development', '..', '')
for (const [key, value] of Object.entries(fileEnv)) {
  process.env[key] ??= value
}

export default defineConfig({
  site: 'https://softmess.de',
  trailingSlash: 'never',
  vite: {plugins: [tailwindcss()]},
})
```

- [ ] **Step 2: Write `site/src/lib/sanity.ts`**

```ts
import {createClient} from '@sanity/client'

export const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET!,
  apiVersion: '2026-08-15',
  useCdn: false,
  token: process.env.SANITY_API_TOKEN,
})
```

- [ ] **Step 3: Write the fixtures**

`site/test/fixtures/siteSettings.json`:

```json
{
  "brand": "softmess",
  "tagline": "project",
  "email": "hi@softmess.de",
  "instagram": "https://www.instagram.com/softmess.project/",
  "instagramHandle": "@softmess.project",
  "copyright": "© 2026 softmess project",
  "seo": {
    "title": "softmess project",
    "description": "handmade charms of paracord and resin clay, made once and probably never again."
  }
}
```

`site/test/fixtures/homePage.json` — the asset ref is a real-shaped Sanity id, which is all `@sanity/image-url` needs to build a CDN URL offline:

```json
{
  "heading": "softmess",
  "statement": "follow the white rabbit.",
  "body": [
    "things I made because I wanted to see if I could — charms of paracord and resin clay, squeezed into shapes that refuse to sit still.",
    "obviously handmade & made once probably. based in 353."
  ],
  "charm": {
    "alt": "A handmade resin-clay charm on a paracord cord",
    "asset": {
      "_ref": "image-0000000000000000000000000000000000000000-966x1207-jpg",
      "_type": "reference"
    }
  },
  "actions": [
    {
      "_key": "instagram",
      "label": "it all happens on instagram",
      "href": "https://www.instagram.com/softmess.project/"
    },
    {"_key": "email", "label": "hi@softmess.de", "href": "mailto:hi@softmess.de"}
  ]
}
```

`site/test/fixtures/legalPages.json`:

```json
[
  {
    "title": "imprint",
    "slug": {"current": "imprint"},
    "kicker": "Angaben gemäß § 5 DDG",
    "body": [
      {
        "_key": "h1",
        "_type": "block",
        "style": "h2",
        "children": [{"_key": "s1", "_type": "span", "text": "Contact", "marks": []}],
        "markDefs": []
      },
      {
        "_key": "p1",
        "_type": "block",
        "style": "normal",
        "children": [
          {"_key": "s2", "_type": "span", "text": "Email: ", "marks": []},
          {"_key": "s3", "_type": "span", "text": "hi@softmess.de", "marks": ["m1"]}
        ],
        "markDefs": [{"_key": "m1", "_type": "link", "href": "mailto:hi@softmess.de"}]
      }
    ]
  },
  {
    "title": "privacy",
    "slug": {"current": "privacy"},
    "kicker": "Datenschutzerklärung · GDPR",
    "body": [
      {
        "_key": "h1",
        "_type": "block",
        "style": "h2",
        "children": [{"_key": "s1", "_type": "span", "text": "Cookies", "marks": []}],
        "markDefs": []
      },
      {
        "_key": "p1",
        "_type": "block",
        "style": "normal",
        "children": [
          {"_key": "s2", "_type": "span", "text": "No cookies are set.", "marks": []}
        ],
        "markDefs": []
      }
    ]
  }
]
```

- [ ] **Step 4: Write the failing test**

`site/test/content.test.ts`:

```ts
import {describe, expect, it} from 'vitest'
import {getHomePage, getLegalPage, getLegalPageSlugs, getSiteSettings} from '../src/lib/content'
import {urlFor} from '../src/lib/image'

describe('content layer in fixture mode', () => {
  it('returns site settings from fixtures', async () => {
    const settings = await getSiteSettings()
    expect(settings.brand).toBe('softmess')
    expect(settings.email).toBe('hi@softmess.de')
  })

  it('returns the home page with two body paragraphs and two actions', async () => {
    const home = await getHomePage()
    expect(home.statement).toBe('follow the white rabbit.')
    expect(home.body).toHaveLength(2)
    expect(home.actions).toHaveLength(2)
    expect(home.actions?.[0].href).toContain('instagram.com')
  })

  it('lists legal page slugs', async () => {
    expect(await getLegalPageSlugs()).toEqual(['imprint', 'privacy'])
  })

  it('finds a legal page by slug and misses cleanly', async () => {
    expect((await getLegalPage('imprint'))?.title).toBe('imprint')
    expect(await getLegalPage('nope')).toBeNull()
  })

  it('builds a Sanity CDN url from an image ref without network access', () => {
    const url = urlFor({
      _type: 'image',
      asset: {_type: 'reference', _ref: 'image-0000000000000000000000000000000000000000-966x1207-jpg'},
    })
      .width(380)
      .format('webp')
      .url()
    expect(url).toContain('cdn.sanity.io')
    expect(url).toContain('w=380')
    expect(url).toContain('fm=webp')
  })
})
```

- [ ] **Step 5: Write `site/vitest.config.ts`**

`SANITY_FIXTURES` is set here so the unit tests exercise fixture mode without a wrapper script.

```ts
import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    env: {SANITY_FIXTURES: '1'},
    include: ['test/**/*.test.ts'],
  },
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter site exec vitest run`
Expected: FAIL — `Failed to resolve import "../src/lib/content"`.

- [ ] **Step 7: Write `site/src/lib/image.ts`**

```ts
import imageUrlBuilder from '@sanity/image-url'
import type {SanityImageSource} from '@sanity/image-url/lib/types/types'

// The builder only needs the project coordinates, not a live client, so this
// works offline and in fixture mode.
const builder = imageUrlBuilder({
  projectId: process.env.SANITY_PROJECT_ID ?? '85i3osnk',
  dataset: process.env.SANITY_DATASET ?? 'production',
})

export function urlFor(source: SanityImageSource) {
  return builder.image(source)
}

/** A 1x/2x srcset for a fixed CSS width. */
export function srcSetFor(source: SanityImageSource, width: number): string {
  return [1, 2]
    .map((density) => `${urlFor(source).width(width * density).format('webp').quality(80).url()} ${density}x`)
    .join(', ')
}
```

- [ ] **Step 8: Write `site/src/lib/content.ts`**

Every query is a `defineQuery` bound to a uniquely-named `const` — TypeGen only discovers queries in that form, and duplicate names silently overwrite each other's types.

```ts
import {defineQuery} from 'groq'
import {client} from './sanity'
import type {
  HOME_PAGE_QUERYResult,
  LEGAL_PAGE_QUERYResult,
  SITE_SETTINGS_QUERYResult,
} from '../sanity.types'

import siteSettingsFixture from '../../test/fixtures/siteSettings.json'
import homePageFixture from '../../test/fixtures/homePage.json'
import legalPagesFixture from '../../test/fixtures/legalPages.json'

// Query results, not raw documents — a projection returns a subset, and the
// `[0]` in each singleton query makes the result nullable. Components import
// these aliases from here rather than reaching into sanity.types themselves.
export type SiteSettings = NonNullable<SITE_SETTINGS_QUERYResult>
export type HomePage = NonNullable<HOME_PAGE_QUERYResult>
export type LegalPage = NonNullable<LEGAL_PAGE_QUERYResult>

const USE_FIXTURES = process.env.SANITY_FIXTURES === '1'

export const SITE_SETTINGS_QUERY = defineQuery(`
  *[_id == "siteSettings"][0]{
    brand, tagline, email, instagram, instagramHandle, copyright,
    seo{title, description, ogImage}
  }
`)

export const HOME_PAGE_QUERY = defineQuery(`
  *[_id == "homePage"][0]{
    heading, statement, body,
    charm{alt, asset},
    actions[]{_key, label, href}
  }
`)

export const LEGAL_PAGE_SLUGS_QUERY = defineQuery(`
  *[_type == "legalPage" && defined(slug.current)].slug.current
`)

export const LEGAL_PAGE_QUERY = defineQuery(`
  *[_type == "legalPage" && slug.current == $slug][0]{
    title, kicker, body, "slug": slug.current
  }
`)

export async function getSiteSettings(): Promise<SiteSettings> {
  if (USE_FIXTURES) return siteSettingsFixture as unknown as SiteSettings
  return (await client.fetch(SITE_SETTINGS_QUERY)) as SiteSettings
}

export async function getHomePage(): Promise<HomePage> {
  if (USE_FIXTURES) return homePageFixture as unknown as HomePage
  return (await client.fetch(HOME_PAGE_QUERY)) as HomePage
}

export async function getLegalPageSlugs(): Promise<string[]> {
  if (USE_FIXTURES) {
    return (legalPagesFixture as Array<{slug: {current: string}}>).map((p) => p.slug.current)
  }
  return (await client.fetch(LEGAL_PAGE_SLUGS_QUERY)) as string[]
}

export async function getLegalPage(slug: string): Promise<LegalPage | null> {
  if (USE_FIXTURES) {
    const match = (legalPagesFixture as Array<{slug: {current: string}}>).find(
      (page) => page.slug.current === slug,
    )
    return (match as unknown as LegalPage) ?? null
  }
  return ((await client.fetch(LEGAL_PAGE_QUERY, {slug})) as LegalPage) ?? null
}
```

- [ ] **Step 9: Generate the query result types**

`content.ts` imports `SITE_SETTINGS_QUERYResult` and friends, which do not exist until
TypeGen has seen the `defineQuery` calls you just wrote. This step must come before any
type-check.

Run: `pnpm typegen`
Expected: `site/src/sanity.types.ts` gains `SITE_SETTINGS_QUERYResult`, `HOME_PAGE_QUERYResult`, `LEGAL_PAGE_SLUGS_QUERYResult`, `LEGAL_PAGE_QUERYResult`.

```bash
grep -E "^export type (SITE_SETTINGS|HOME_PAGE|LEGAL_PAGE|LEGAL_PAGE_SLUGS)_QUERYResult" site/src/sanity.types.ts
```

Expected: four matching lines. If TypeGen reports "no queries found", the `path` glob in
`studio/sanity.cli.ts` is wrong — it must be `../site/src/**/*.{ts,astro}`.

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm --filter site exec vitest run`
Expected: PASS, 5 tests.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(site): add Sanity content layer with offline fixture mode"
```

---

## Task 4: Tailwind theme, base layout, header and footer

**Files:**
- Create: `site/src/styles/theme.css`, `site/src/layouts/Base.astro`
- Create: `site/src/components/Header.astro`, `site/src/components/Footer.astro`
- Create: `site/src/pages/404.astro`

**Interfaces:**
- Consumes: `getSiteSettings()` from Task 3
- Produces: `Base.astro` with props `{title: string; description?: string; settings: SiteSettings}`; `Header.astro` and `Footer.astro` each with prop `{settings: SiteSettings}`

- [ ] **Step 1: Write `site/src/styles/theme.css`**

Values come straight from the mockup's `:root` override. `--spacing: 4.4px` is the load-bearing line: it makes Tailwind's whole numeric scale land on the Organic kit's steps, so `p-8` is exactly the kit's `--space-8` of 35.2px.

```css
@import 'tailwindcss';

@theme {
  --color-bg: #f5f2ea;
  --color-surface: #ece8dd;
  --color-ink: #17161c;
  --color-muted: #6e6b64;
  --color-accent: #3a1fd8;
  --color-accent-200: #ded9f7;
  --color-accent-600: #2f18b8;
  --color-accent-700: #2a15a4;
  --color-accent-800: #221082;
  --color-sand-200: #e6e3d8;

  --font-display: 'Bagel Fat One', system-ui, sans-serif;
  --font-sans: 'Outfit', system-ui, sans-serif;

  /* The Organic kit's spacing base. Tailwind's n-* scale multiplies this,
     so p-1/2/3/4/6/8 == the kit's --space-1/2/3/4/6/8 exactly. */
  --spacing: 4.4px;

  --text-hero: clamp(52px, 10vw, 120px);
  --text-statement: clamp(22px, 3.4vw, 34px);
  --text-page-title: clamp(36px, 6vw, 56px);

  --shadow-charm: 0 12px 32px color-mix(in srgb, #2e2b25 22%, transparent);
  --animate-drift: drift 14s ease-in-out infinite;
}

@keyframes drift {
  0%,
  100% {
    transform: translate3d(0, 0, 0) rotate(0deg);
  }
  50% {
    transform: translate3d(0, -18px, 0) rotate(4deg);
  }
}

/* The mockup's asymmetric charm silhouette — rounded at the top, tapering
   below. Not expressible as a Tailwind radius scale value. */
@utility charm-blob {
  border-radius: 999px 999px 260px 260px / 999px 999px 300px 300px;
}

@utility washed {
  filter: saturate(0.6) contrast(0.85) brightness(1.1) opacity(0.94);
}

@media (prefers-reduced-motion: reduce) {
  .animate-drift {
    animation: none;
  }
}
```

The reduced-motion block is not decoration: a 14-second infinite drift is exactly the kind of ambient movement that triggers vestibular symptoms.

- [ ] **Step 2: Write `site/src/components/Header.astro`**

```astro
---
import type {SiteSettings} from '../lib/content'
interface Props {
  settings: SiteSettings
}
const {settings} = Astro.props
---

<header class="relative flex items-center justify-between gap-4 px-[clamp(24px,6vw,88px)] py-6">
  <a
    href="/"
    class="font-display text-[22px] tracking-[0.01em] text-accent no-underline"
    >{settings.brand}</a
  >
  <span class="text-[13px] uppercase tracking-[0.14em] text-muted">{settings.tagline}</span>
</header>
```

- [ ] **Step 3: Write `site/src/components/Footer.astro`**

```astro
---
import type {SiteSettings} from '../lib/content'
interface Props {
  settings: SiteSettings
}
const {settings} = Astro.props
const linkClass = 'inline-flex min-h-[44px] items-center text-accent-700 hover:text-accent-800'
---

<footer
  class="relative flex flex-wrap items-center gap-x-6 gap-y-2 px-[clamp(24px,6vw,88px)] pt-6 pb-8 text-[15px] text-muted"
>
  <span>{settings.copyright}</span>
  <nav class="flex flex-wrap gap-x-4 gap-y-1">
    <a class={linkClass} href="/imprint">imprint</a>
    <a class={linkClass} href="/privacy">privacy</a>
    <a class={linkClass} href={settings.instagram} target="_blank" rel="noopener noreferrer"
      >instagram</a
    >
  </nav>
</footer>
```

- [ ] **Step 4: Write `site/src/layouts/Base.astro`**

The `@fontsource` imports are what keep the privacy policy honest — Astro bundles and fingerprints the woff2 files, so nothing is fetched from Google.

```astro
---
import '@fontsource/bagel-fat-one/400.css'
import '@fontsource/outfit/300.css'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/700.css'
import '../styles/theme.css'
import Header from '../components/Header.astro'
import Footer from '../components/Footer.astro'
import type {SiteSettings} from '../lib/content'

interface Props {
  title: string
  description?: string
  settings: SiteSettings
}

const {title, description, settings} = Astro.props
const metaDescription = description ?? settings.seo?.description ?? ''
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    {metaDescription && <meta name="description" content={metaDescription} />}
    <meta property="og:title" content={title} />
    {metaDescription && <meta property="og:description" content={metaDescription} />}
    <meta property="og:type" content="website" />
    <link rel="canonical" href={new URL(Astro.url.pathname, Astro.site).href} />
  </head>
  <body
    class="relative flex min-h-dvh flex-col overflow-x-hidden bg-bg font-sans text-ink"
  >
    <div
      aria-hidden="true"
      class="pointer-events-none absolute -top-[22vw] -right-[20vw] aspect-square w-[clamp(280px,62vw,520px)] rounded-full bg-sand-200 opacity-55"
    >
    </div>
    <div
      aria-hidden="true"
      class="pointer-events-none absolute -bottom-[26vw] -left-[22vw] aspect-square w-[clamp(260px,58vw,460px)] rounded-full bg-accent-200 opacity-45"
    >
    </div>

    <Header settings={settings} />
    <slot />
    <Footer settings={settings} />
  </body>
</html>
```

- [ ] **Step 5: Write `site/src/pages/404.astro`**

```astro
---
import Base from '../layouts/Base.astro'
import {getSiteSettings} from '../lib/content'

const settings = await getSiteSettings()
---

<Base title={`not found · ${settings.brand}`} settings={settings}>
  <main class="relative flex-1 px-[clamp(24px,6vw,88px)] py-8">
    <h1 class="mb-6 font-display text-[length:var(--text-page-title)] font-normal text-accent">
      lost
    </h1>
    <p class="mb-8 text-[18px]">that page isn't here.</p>
    <a
      href="/"
      class="inline-flex min-h-[48px] items-center gap-2 rounded-full border border-ink/18 px-[22px] text-[16px] text-ink no-underline hover:bg-ink/7"
      >← back</a
    >
  </main>
</Base>
```

- [ ] **Step 6: Verify the fixture build succeeds and self-hosts fonts**

Run: `pnpm --filter site build:fixtures`
Expected: build completes, writes `site/dist-fixtures/404.html`.

Then:

```bash
grep -c "fonts.googleapis.com\|fonts.gstatic.com" site/dist-fixtures/404.html || echo "no google fonts — good"
ls site/dist-fixtures/_astro/*.woff2 | head -3
```

Expected: no Google Fonts matches; woff2 files present in `_astro/`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(site): add Tailwind theme, base layout, header and footer"
```

---

## Task 5: Home page

**Files:**
- Create: `site/src/components/CharmImage.astro`, `site/src/pages/index.astro`

**Interfaces:**
- Consumes: `getSiteSettings()`, `getHomePage()`, `srcSetFor()`, `urlFor()`, `Base.astro`
- Produces: the `/` route

- [ ] **Step 1: Write `site/src/components/CharmImage.astro`**

```astro
---
import {srcSetFor, urlFor} from '../lib/image'
import type {HomePage} from '../lib/content'

interface Props {
  charm: NonNullable<HomePage['charm']>
}
const {charm} = Astro.props
const WIDTH = 380
---

<figure class="relative m-0 justify-self-center">
  <div class="absolute inset-y-[-6%] inset-x-[-8%] rounded-full bg-surface opacity-70"></div>
  <img
    src={urlFor(charm).width(WIDTH).format('webp').quality(80).url()}
    srcset={srcSetFor(charm, WIDTH)}
    alt={charm.alt}
    width={WIDTH}
    height={Math.round(WIDTH * 1.25)}
    loading="eager"
    decoding="async"
    class="charm-blob washed animate-drift relative w-[min(380px,74vw)] aspect-[4/5] object-cover shadow-charm"
  />
</figure>
```

- [ ] **Step 2: Write `site/src/pages/index.astro`**

The first action renders filled and the rest outlined. That is a rendering convention over `actions[]`, deliberately not a stored field.

```astro
---
import Base from '../layouts/Base.astro'
import CharmImage from '../components/CharmImage.astro'
import {getHomePage, getSiteSettings} from '../lib/content'

const [settings, home] = await Promise.all([getSiteSettings(), getHomePage()])
const title = settings.seo?.title ?? `${settings.brand} ${settings.tagline ?? ''}`.trim()

const primary =
  'flex-[1_1_260px] bg-accent text-bg shadow-sm hover:bg-accent-600 active:bg-accent-700'
const secondary = 'flex-[1_1_200px] border border-ink/18 text-ink hover:bg-ink/7'
---

<Base title={title} settings={settings}>
  <main
    class="relative grid flex-1 grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-center gap-[clamp(28px,6vw,72px)] px-[clamp(22px,6vw,88px)] pt-[clamp(8px,3vw,48px)] pb-[clamp(32px,6vw,72px)]"
  >
    <div class="max-w-[620px]">
      <h1
        class="mb-4 font-display text-[length:var(--text-hero)] leading-none font-normal tracking-[0.01em] text-accent"
      >
        {home.heading}
      </h1>
      <p
        class="mb-6 text-[length:var(--text-statement)] leading-[1.2] font-bold tracking-[-0.01em] text-ink"
      >
        {home.statement}
      </p>

      {
        home.body?.map((paragraph, index) => (
          <p
            class:list={[
              'max-w-[44ch] text-[18px] leading-[1.6] text-pretty',
              index === 0 ? 'mb-2 text-ink' : 'mb-8 text-muted',
            ]}
          >
            {paragraph}
          </p>
        ))
      }

      <div class="flex flex-wrap items-center gap-3">
        {
          home.actions?.map((action, index) => (
            <a
              href={action.href}
              {...action.href?.startsWith('http')
                ? {target: '_blank', rel: 'noopener noreferrer'}
                : {}}
              class:list={[
                'inline-flex min-h-[54px] items-center justify-center gap-[10px] rounded-full px-[26px] font-sans text-[17px] no-underline',
                index === 0 ? primary : secondary,
              ]}
            >
              {action.label}
            </a>
          ))
        }
      </div>
    </div>

    {home.charm && <CharmImage charm={home.charm} />}
  </main>
</Base>
```

- [ ] **Step 3: Verify the home page builds and renders the fixture content**

Run: `pnpm --filter site build:fixtures`
Then:

```bash
grep -o "follow the white rabbit." site/dist-fixtures/index.html
grep -c "cdn.sanity.io" site/dist-fixtures/index.html
grep -o "it all happens on instagram" site/dist-fixtures/index.html
```

Expected: the statement appears, at least one `cdn.sanity.io` reference (the charm srcset), and the Instagram action label.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(site): add home page with charm image and CTA actions"
```

---

## Task 6: Legal pages and the full dist test suite

**Files:**
- Create: `site/src/components/Prose.astro`, `site/src/pages/[slug].astro`
- Create: `site/test/dist.test.ts`

**Interfaces:**
- Consumes: `getLegalPageSlugs()`, `getLegalPage()`, `Base.astro`
- Produces: `/imprint` and `/privacy` routes

- [ ] **Step 1: Write the failing dist test suite**

Write `site/test/dist.test.ts` exactly as given in Step 5 below. Do not write the page
components first — the point of this step is to watch the suite fail for the right reason.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter site test`
Expected: FAIL — the fixture build errors or the `emits every route` assertion fails,
because `imprint/index.html` and `privacy/index.html` do not exist yet. If instead the
suite passes, the routes are already being generated and something is wrong with the test.

- [ ] **Step 3: Write `site/src/components/Prose.astro`**

`astro-portabletext` needs explicit components for the two block styles and the link annotation; without them, links render as plain text.

```astro
---
import {PortableText} from 'astro-portabletext'
import type {PortableTextComponents} from 'astro-portabletext/types'
import Heading from './prose/Heading.astro'
import Paragraph from './prose/Paragraph.astro'
import Link from './prose/Link.astro'

interface Props {
  value: unknown
}
const {value} = Astro.props

const components: PortableTextComponents = {
  block: {h2: Heading, normal: Paragraph},
  mark: {link: Link},
}
---

<PortableText value={value as any} components={components} />
```

`site/src/components/prose/Heading.astro`:

```astro
---
---

<h2 class="mt-6 mb-2 font-sans text-[22px] font-bold text-ink">
  <slot />
</h2>
```

`site/src/components/prose/Paragraph.astro`:

```astro
---
---

<p class="mb-6 text-[17px] leading-[1.7]">
  <slot />
</p>
```

`site/src/components/prose/Link.astro`:

Confirm the prop shape rather than trusting this: `astro-portabletext` hands mark
components the annotation on `node.markDef`. If the rendered `href` comes out as `#`, log
`Astro.props` once and read the actual shape. The `a[href="mailto:hi@softmess.de"]`
assertion in Step 5 is what catches this.

```astro
---
const {node} = Astro.props
const href: string = node?.markDef?.href ?? '#'
const external = href.startsWith('http')
---

<a
  href={href}
  {...external ? {target: '_blank', rel: 'noopener noreferrer'} : {}}
  class="text-accent-700 underline decoration-1 underline-offset-[3px] hover:text-accent-800"
>
  <slot />
</a>
```

- [ ] **Step 4: Write `site/src/pages/[slug].astro`**

Astro hoists `getStaticPaths()` into a separate module context. Constants declared in the
frontmatter are **not** visible inside it and referencing one throws `ReferenceError` at
build time — but `import` statements are, which is why `getLegalPageSlugs` can be called
directly. Never inline a `defineQuery` const in the frontmatter and use it here.

```astro
---
import Base from '../layouts/Base.astro'
import Prose from '../components/Prose.astro'
import {getLegalPage, getLegalPageSlugs, getSiteSettings} from '../lib/content'

export async function getStaticPaths() {
  const slugs = await getLegalPageSlugs()
  return slugs.map((slug) => ({params: {slug}}))
}

const {slug} = Astro.params
const [settings, page] = await Promise.all([getSiteSettings(), getLegalPage(slug!)])

if (!page) {
  throw new Error(`No legalPage found for slug "${slug}"`)
}
---

<Base title={`${page.title} · ${settings.brand}`} settings={settings}>
  <main
    class="relative max-w-[760px] flex-1 px-[clamp(24px,6vw,88px)] pt-[clamp(16px,3vw,32px)] pb-[clamp(48px,6vw,80px)]"
  >
    <h1
      class="mb-6 font-display text-[length:var(--text-page-title)] font-normal text-accent"
    >
      {page.title}
    </h1>
    {
      page.kicker && (
        <p class="mb-6 text-[13px] uppercase tracking-[0.12em] text-muted">{page.kicker}</p>
      )
    }

    <Prose value={page.body} />

    <a
      href="/"
      class="mt-8 inline-flex min-h-[48px] items-center gap-2 rounded-full border border-ink/18 px-[22px] text-[16px] text-ink no-underline hover:bg-ink/7"
      >← back</a
    >
  </main>
</Base>
```

- [ ] **Step 5: The dist test suite referenced by Step 1**

`site/test/dist.test.ts`. The last three assertions are the ones worth having — they encode promises the site makes in its own legal text.

```ts
import {readFileSync, existsSync} from 'node:fs'
import {join} from 'node:path'
import {parseHTML} from 'linkedom'
import {beforeAll, describe, expect, it} from 'vitest'

const DIST = join(import.meta.dirname, '..', 'dist-fixtures')
const PAGES = ['index.html', 'imprint/index.html', 'privacy/index.html', '404.html']

function doc(page: string) {
  return parseHTML(readFileSync(join(DIST, page), 'utf8')).document
}

beforeAll(() => {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error('Run `pnpm --filter site build:fixtures` before the dist tests')
  }
})

describe('built pages', () => {
  it('emits every route', () => {
    for (const page of PAGES) expect(existsSync(join(DIST, page)), page).toBe(true)
  })

  it('gives each page a title and a description', () => {
    for (const page of ['index.html', 'imprint/index.html', 'privacy/index.html']) {
      const d = doc(page)
      expect(d.title.length, page).toBeGreaterThan(0)
      expect(d.querySelector('meta[name="description"]'), page).not.toBeNull()
    }
  })
})

describe('home page', () => {
  it('renders the hero copy', () => {
    const text = doc('index.html').body.textContent ?? ''
    expect(text).toContain('softmess')
    expect(text).toContain('follow the white rabbit.')
    expect(text).toContain('refuse to sit still')
  })

  it('renders the charm as a responsive Sanity CDN image', () => {
    const img = doc('index.html').querySelector('main img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toContain('cdn.sanity.io')
    expect(img!.getAttribute('srcset')).toContain('2x')
    expect(img!.getAttribute('alt')?.length).toBeGreaterThan(0)
  })

  it('renders one button per action, first one filled', () => {
    const links = [...doc('index.html').querySelectorAll('main > div > div > a')]
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute('class')).toContain('bg-accent')
    expect(links[1].getAttribute('href')).toBe('mailto:hi@softmess.de')
  })
})

describe('legal pages', () => {
  it('renders portable text headings, paragraphs and mailto links', () => {
    const d = doc('imprint/index.html')
    expect(d.querySelector('main h2')?.textContent).toBe('Contact')
    expect(d.querySelector('main p')).not.toBeNull()
    expect(d.querySelector('a[href="mailto:hi@softmess.de"]')).not.toBeNull()
  })

  it('renders the kicker', () => {
    expect(doc('privacy/index.html').body.textContent).toContain('Datenschutzerklärung')
  })
})

describe('promises the site makes in its own privacy policy', () => {
  it('ships no unfilled placeholder text', () => {
    for (const page of PAGES) {
      const text = doc(page).body.textContent ?? ''
      const placeholders = text.match(/\[[a-z][^\]]{2,}\]/g) ?? []
      expect(placeholders, `${page} still contains ${placeholders.join(', ')}`).toEqual([])
    }
  })

  it('loads no third-party subresource', () => {
    const allowed = /^(\/|\.|data:|#)|cdn\.sanity\.io/
    for (const page of PAGES) {
      const d = doc(page)
      const refs = [
        // rel=canonical is an absolute self-reference, not a fetched
        // subresource — it points at https://softmess.de by design.
        ...[...d.querySelectorAll('link[href]:not([rel="canonical"])')].map(
          (n) => n.getAttribute('href')!,
        ),
        ...[...d.querySelectorAll('img[src], script[src]')].map(
          (n) => n.getAttribute('src')!,
        ),
        ...[...d.querySelectorAll('[srcset]')].flatMap((n) =>
          n.getAttribute('srcset')!.split(',').map((s) => s.trim().split(/\s+/)[0]),
        ),
      ]
      for (const ref of refs) {
        expect(allowed.test(ref), `${page} loads ${ref}`).toBe(true)
      }
    }
  })

  it('ships no JavaScript', () => {
    for (const page of PAGES) {
      expect(doc(page).querySelectorAll('script'), page).toHaveLength(0)
    }
  })
})
```

- [ ] **Step 6: Run the tests to verify they now pass**

Run: `pnpm --filter site test`
Expected: PASS, all suites.

If "renders one button per action" fails on the selector, print the actual structure with `node -e` and fix the selector to match the emitted DOM rather than loosening the assertion.

- [ ] **Step 7: Run the full verification gate**

Run: `pnpm verify`
Expected: PASS — no typegen drift, `astro check` clean, fixture build succeeds, all tests green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(site): add legal pages and dist test suite"
```

---

## Task 7: Seed Sanity with the mockup's content

**Files:**
- Create: `seed/seed.ts`, `seed/package.json`
- Modify: `pnpm-workspace.yaml` (add `seed`)

**Interfaces:**
- Consumes: the schema from Task 2
- Produces: `siteSettings`, `homePage`, and two `legalPage` documents in the `production` dataset

**Blocking input:** the imprint requires a real postal address. `[street and number]` and `[postcode and city]` fail the placeholder test in Task 6, so the site cannot deploy while they are present. Either substitute the real address in Step 3 before running, or seed as-is and enter it in the Studio before Task 9.

- [ ] **Step 1: Add `seed` to the workspace**

`pnpm-workspace.yaml` `packages:` becomes:

```yaml
packages:
  - site
  - studio
  - seed
```

`seed/package.json`:

```json
{
  "name": "seed",
  "private": true,
  "type": "module",
  "scripts": {
    "seed": "node --env-file=../.env --env-file=../.env.local seed.ts"
  },
  "dependencies": {
    "@sanity/client": "^8.0.0"
  }
}
```

Node ≥ 22.18 strips TypeScript types natively, so `seed.ts` runs without a build step and
without `--experimental-strip-types` (that flag is a no-op or an error on newer Node). If
the run fails with a TypeScript syntax error, add `--experimental-strip-types` back.

Then: `pnpm install`

- [ ] **Step 2: Confirm a write-capable token is available**

The `SANITY_API_TOKEN` in `.env.local` is **read-only** — it can query but a write returns `Insufficient permissions; permission "create" required`. Seeding needs the CLI's admin credentials instead:

```bash
SANITY_WRITE_TOKEN=$(npx sanity debug --secrets 2>/dev/null | grep -A0 'Auth token:' | awk '{print $3}')
test -n "$SANITY_WRITE_TOKEN" && echo "have write token" || echo "run: npx sanity login"
```

Export it for the seed run only. Do **not** write it into any file.

- [ ] **Step 3: Write `seed/seed.ts`**

`createIfNotExists`, never `createOrReplace` — re-running this script must never clobber edits made in the Studio.

```ts
import {createReadStream} from 'node:fs'
import {createClient} from '@sanity/client'

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET!,
  apiVersion: '2026-08-15',
  useCdn: false,
  token: process.env.SANITY_WRITE_TOKEN,
})

// Replace these before running, or fill them in the Studio before deploying.
// The dist test suite fails while any [bracketed] placeholder survives.
const STREET = '[street and number]'
const CITY = '[postcode and city]'

const block = (text: string, style: 'normal' | 'h2' = 'normal', key: string) => ({
  _key: key,
  _type: 'block',
  style,
  markDefs: [],
  children: [{_key: `${key}s`, _type: 'span', text, marks: []}],
})

const emailBlock = (prefix: string, key: string) => ({
  _key: key,
  _type: 'block',
  style: 'normal',
  markDefs: [{_key: `${key}m`, _type: 'link', href: 'mailto:hi@softmess.de'}],
  children: [
    {_key: `${key}a`, _type: 'span', text: prefix, marks: []},
    {_key: `${key}b`, _type: 'span', text: 'hi@softmess.de', marks: [`${key}m`]},
  ],
})

async function uploadCharm(file: string, label: string) {
  const asset = await client.assets.upload('image', createReadStream(file), {filename: file})
  console.log(`uploaded ${label}: ${asset._id}`)
  return asset._id
}

async function main() {
  const redId = await uploadCharm('images/charm-red.jpg', 'charm-red')
  await uploadCharm('images/charm-green.jpg', 'charm-green')

  await client.createIfNotExists({
    _id: 'siteSettings',
    _type: 'siteSettings',
    brand: 'softmess',
    tagline: 'project',
    email: 'hi@softmess.de',
    instagram: 'https://www.instagram.com/softmess.project/',
    instagramHandle: '@softmess.project',
    copyright: '© 2026 softmess project',
    seo: {
      title: 'softmess project',
      description:
        'handmade charms of paracord and resin clay, squeezed into shapes that refuse to sit still.',
    },
  })

  await client.createIfNotExists({
    _id: 'homePage',
    _type: 'homePage',
    heading: 'softmess',
    statement: 'follow the white rabbit.',
    body: [
      'things I made because I wanted to see if I could — charms of paracord and resin clay, squeezed into shapes that refuse to sit still.',
      'obviously handmade & made once probably. based in 353.',
    ],
    charm: {
      _type: 'image',
      alt: 'A handmade resin-clay charm on a paracord cord',
      asset: {_type: 'reference', _ref: redId},
    },
    actions: [
      {
        _key: 'instagram',
        _type: 'action',
        label: 'it all happens on instagram',
        href: 'https://www.instagram.com/softmess.project/',
      },
      {_key: 'email', _type: 'action', label: 'hi@softmess.de', href: 'mailto:hi@softmess.de'},
    ],
  })

  await client.create({
    _type: 'legalPage',
    title: 'imprint',
    slug: {_type: 'slug', current: 'imprint'},
    kicker: 'Angaben gemäß § 5 DDG',
    body: [
      block('Responsible for this site', 'h2', 'a1'),
      block(`Dorina Mazetti, softmess project, ${STREET}, ${CITY}, Germany`, 'normal', 'a2'),
      block('Contact', 'h2', 'b1'),
      emailBlock('Email: ', 'b2'),
      block('Responsible for editorial content', 'h2', 'c1'),
      block('Dorina Mazetti (address as above), § 18 (2) MStV.', 'normal', 'c2'),
      block('VAT', 'h2', 'd1'),
      block(
        'Small business under § 19 UStG — no VAT is charged and no VAT identification number is issued.',
        'normal',
        'd2',
      ),
      block('Dispute resolution', 'h2', 'e1'),
      block(
        'We are neither obliged nor willing to take part in dispute resolution proceedings before a consumer arbitration board.',
        'normal',
        'e2',
      ),
      block('Liability', 'h2', 'f1'),
      block(
        'The contents of this page are prepared with care, but no guarantee is given for their accuracy, completeness or timeliness.',
        'normal',
        'f2',
      ),
      block(
        'This site links to external websites whose content we do not control. Responsibility for linked content lies with its respective operators; no unlawful content was apparent at the time of linking.',
        'normal',
        'f3',
      ),
      block('Copyright', 'h2', 'g1'),
      block(
        'All photographs and texts on this site are made by Dorina Mazetti. Please ask before reusing them.',
        'normal',
        'g2',
      ),
    ],
  })

  await client.create({
    _type: 'legalPage',
    title: 'privacy',
    slug: {_type: 'slug', current: 'privacy'},
    kicker: 'Datenschutzerklärung · GDPR',
    body: [
      block(
        'This is a small placeholder site. It has no accounts, no shop, no cookies, no analytics and no advertising. The only data processed is what your browser has to send in order to load the page.',
        'normal',
        'p0',
      ),
      block('Controller', 'h2', 'p1'),
      block(`Dorina Mazetti, ${STREET}, ${CITY}, Germany`, 'normal', 'p2'),
      block('Hosting and server logs', 'h2', 'p3'),
      block(
        'The site is hosted on Cloudflare Workers (Cloudflare, Inc. / Cloudflare Germany GmbH). When you open a page, the hoster processes your IP address, the time of the request, the page requested, referrer, and browser and operating system details. This is technically necessary to deliver the page and to keep it secure; the legal basis is our legitimate interest, Art. 6 (1) (f) GDPR. Logs are kept only briefly and are not merged with other data. Cloudflare operates a global network, so transfers to third countries can occur on the basis of the EU Standard Contractual Clauses; a data processing agreement under Art. 28 GDPR is in place.',
        'normal',
        'p4',
      ),
      block('Cookies, analytics, fonts', 'h2', 'p5'),
      block(
        "No cookies are set, no tracking or analytics tools are used, and fonts and images are served from this site's own server.",
        'normal',
        'p6',
      ),
      block('Instagram', 'h2', 'p7'),
      block(
        'The Instagram button is a plain link. Nothing is loaded from Meta while you are on this site, and no data is sent to Meta unless you click it. If you follow the link, Meta Platforms Ireland Ltd. processes your data under its own privacy policy, over which we have no influence.',
        'normal',
        'p8',
      ),
      block('Contacting us by email', 'h2', 'p9'),
      emailBlock('If you write to ', 'p10'),
      block('Your rights', 'h2', 'p11'),
      block(
        'You have the right to access, rectification, erasure, restriction of processing, data portability and objection (Art. 15–21 GDPR). Where processing rests on consent, you may withdraw it at any time.',
        'normal',
        'p12',
      ),
      block(
        'You may also lodge a complaint with a data protection supervisory authority — usually the authority of the federal state in which the controller is based.',
        'normal',
        'p13',
      ),
      block('Encryption', 'h2', 'p14'),
      block(
        'This site is delivered over TLS (https), so the connection between your browser and the server is encrypted.',
        'normal',
        'p15',
      ),
    ],
  })

  console.log('seeded')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

Note the privacy copy is reproduced verbatim from the mockup, including the claim that fonts are self-hosted — which Task 4 made true.

- [ ] **Step 4: Run the seed**

```bash
cd seed && SANITY_WRITE_TOKEN="$SANITY_WRITE_TOKEN" pnpm seed
```

Expected: two "uploaded" lines and "seeded".

- [ ] **Step 5: Verify the content landed**

```bash
npx sanity documents query '*[_type in ["siteSettings","homePage","legalPage"]]{_id,_type,title}'
```

Expected: four documents — `siteSettings`, `homePage`, and two `legalPage`s with titles `imprint` and `privacy`.

- [ ] **Step 6: Verify a real (non-fixture) build works end to end**

Run: `pnpm build:site`
Expected: PASS — writes `site/dist/{index,imprint/index,privacy/index,404}.html` from live Sanity data.

```bash
grep -o "follow the white rabbit." site/dist/index.html
grep -oE "\[[a-z][^]]{2,}\]" site/dist/imprint/index.html || echo "no placeholders — deployable"
```

If placeholders are still present, the address has not been supplied. Fill it in the Studio (`pnpm --filter studio dev`, Legal pages → imprint) and rebuild before continuing.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(seed): add one-shot content seeding script"
```

---

## Task 8: Cloudflare Workers and the first deploy

**Files:**
- Create: `site/wrangler.jsonc`, `studio/wrangler.jsonc`
- Modify: `studio/package.json` (add `wrangler` devDependency)

**Interfaces:**
- Consumes: `site/dist` from Task 7, `studio/dist` from Task 1
- Produces: Workers `softmess` and `softmess-studio` serving `softmess.de`, `www.softmess.de`, `studio.softmess.de`

- [ ] **Step 1: Verify the Cloudflare token can provision custom domains**

```bash
set -a; source .env.local; set +a
npx wrangler whoami
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/7ace224ab1450f917eeeb48863ae630f/dns_records?per_page=5" \
  | head -c 200
```

Expected: `whoami` names the account; the DNS call returns `"success":true`. If DNS returns an auth error, the token lacks `Zone:DNS:Edit` — stop and report it; the fallback is adding the three proxied records by hand in the dashboard, after which `custom_domain: true` will bind to them.

- [ ] **Step 2: Write `site/wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "softmess",
  "compatibility_date": "2026-08-15",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page"
  },
  "routes": [
    {"pattern": "softmess.de", "custom_domain": true},
    {"pattern": "www.softmess.de", "custom_domain": true}
  ]
}
```

There is no `main` key — this is an assets-only Worker with no code.

- [ ] **Step 3: Write `studio/wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "softmess-studio",
  "compatibility_date": "2026-08-15",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  },
  "routes": [{"pattern": "studio.softmess.de", "custom_domain": true}]
}
```

`single-page-application` is what makes Studio deep links like `/structure/homePage` work — any unmatched path serves `index.html` and the Studio's client router takes over.

- [ ] **Step 4: Add wrangler to the Studio package**

Run: `pnpm --filter studio add -D wrangler@^4.123.0`

- [ ] **Step 5: Deploy the site**

```bash
set -a; source .env.local; set +a
pnpm build:site
pnpm --filter site exec wrangler deploy
```

Expected: wrangler reports the upload and lists `softmess.de` and `www.softmess.de` as custom domains.

- [ ] **Step 6: Deploy the Studio**

```bash
set -a; source .env.local; set +a
pnpm build:studio
pnpm --filter studio exec wrangler deploy
```

Expected: `studio.softmess.de` bound.

- [ ] **Step 7: Add the Studio's CORS origin**

The Studio is served from an origin Sanity does not yet trust, so its API calls will fail with a CORS error until this is added.

```bash
npx sanity cors add https://studio.softmess.de --credentials
npx sanity cors list
```

Expected: the list includes `https://studio.softmess.de` and `http://localhost:3333`.

- [ ] **Step 8: Verify all three hostnames**

```bash
for url in https://softmess.de https://www.softmess.de https://studio.softmess.de; do
  printf "%-32s %s\n" "$url" "$(curl -s -o /dev/null -w '%{http_code}' "$url")"
done
curl -s https://softmess.de | grep -o "follow the white rabbit."
curl -s -o /dev/null -w "%{http_code}\n" https://softmess.de/nope
```

Expected: three `200`s, the statement present, and `404` for the missing route. TLS certificates can take a minute or two to issue — retry rather than reconfiguring.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(deploy): add Cloudflare Worker configs for site and studio"
```

---

## Task 9: GitHub Actions and repository wiring

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: root scripts from Task 1, wrangler configs from Task 8
- Produces: automated deploys on push to `main` and on `repository_dispatch: sanity-publish`

- [ ] **Step 1: Write `.github/workflows/deploy.yml`**

```yaml
name: deploy

on:
  push:
    branches: [main]
  pull_request:
  repository_dispatch:
    types: [sanity-publish]
  workflow_dispatch:

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: true

env:
  SANITY_PROJECT_ID: 85i3osnk
  SANITY_DATASET: production

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm verify

  deploy-site:
    needs: verify
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build:site
        env:
          SANITY_API_TOKEN: ${{ secrets.SANITY_API_TOKEN }}
      - run: pnpm --filter site exec wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

  deploy-studio:
    needs: verify
    # The Studio bundle only changes when the schema or its dependencies do,
    # never when content is published — so content webhooks skip this job.
    if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build:studio
      - run: pnpm --filter studio exec wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

`verify` runs `pnpm verify`, which uses fixture mode — no secrets, so pull requests from forks pass.

**Known risk in this step:** `pnpm verify` begins with `pnpm typegen`, which runs
`sanity schemas extract`. That loads the Studio config locally and should need no
network, but CI has no `sanity login`. If the `verify` job fails with an authentication
or "no active project" error, do **not** put a Sanity token in the job. Instead, commit
the extracted schema and split the script so CI only regenerates types:

1. Remove `studio/schema.json` from `.gitignore` and commit it.
2. Add to `studio/package.json`: `"typegen:generate": "sanity typegen generate"`.
3. Change the root `verify` script's first command from `pnpm typegen` to
   `pnpm --filter studio typegen:generate`.

Local development keeps using the full `pnpm typegen`, so `schema.json` stays current;
the committed copy is what CI checks against, and drift still fails the `git diff` gate.

- [ ] **Step 2: Wire the git remote**

```bash
git remote add origin https://github.com/softmess-project/site.git
git remote -v
```

- [ ] **Step 3: Set the Actions secrets**

```bash
set -a; source .env.local; set +a
gh secret set SANITY_API_TOKEN     --repo softmess-project/site --body "$SANITY_API_TOKEN"
gh secret set CLOUDFLARE_API_TOKEN --repo softmess-project/site --body "$CLOUDFLARE_API_TOKEN"
gh secret set CLOUDFLARE_ACCOUNT_ID --repo softmess-project/site --body "$CLOUDFLARE_ACCOUNT_ID"
gh secret list --repo softmess-project/site
```

Expected: three secrets listed. `SANITY_API_TOKEN` is deliberately the read-only one — a build only ever reads.

- [ ] **Step 4: Confirm no secret is about to be committed**

The repo is public. Verify before the first push:

```bash
git check-ignore -v .env.local
git ls-files | grep -E "^\.env" || echo "no env files tracked yet"
git grep -nE "sk[A-Za-z0-9]{40,}|cfat_|github_pat_|gho_" -- . ':!pnpm-lock.yaml' || echo "no secrets in tracked content"
```

Expected: `.env.local` is ignored, and the grep finds nothing. `.env` (project id + dataset only) may be added: `git add -f .env` is not needed — it is not ignored, so `git add .env` suffices.

- [ ] **Step 5: Push and watch the first run**

```bash
git add .env
git commit -m "ci: add deploy workflow"
git push -u origin main
gh run watch --repo softmess-project/site
```

Expected: `verify`, `deploy-site` and `deploy-studio` all green.

- [ ] **Step 6: Verify the deploy actually shipped**

```bash
curl -s https://softmess.de | grep -o "follow the white rabbit."
curl -s -o /dev/null -w "%{http_code}\n" https://studio.softmess.de
```

Expected: the statement and `200`.

---

## Task 10: Sanity publish webhook

**Files:** none — this configures the Sanity project, not the repo.

**Interfaces:**
- Consumes: the workflow's `repository_dispatch: sanity-publish` trigger from Task 9
- Produces: a Sanity webhook that redeploys the site when content is published

- [ ] **Step 1: Verify the GitHub PAT can fire a repository dispatch**

`GITHUB_TOKEN` in `.env.local` is a fine-grained PAT and needs `Contents: read and write` on `softmess-project/site`. Test it directly — a dispatch with no matching workflow filter is harmless:

```bash
set -a; source .env.local; set +a
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/softmess-project/site/dispatches \
  -d '{"event_type":"sanity-publish"}'
```

Expected: `204`. A `403` means the PAT lacks `Contents: write` — regenerate it with that permission before continuing. A `404` usually also means insufficient permission rather than a missing repo.

- [ ] **Step 2: Confirm the dispatch triggered a deploy**

```bash
gh run list --repo softmess-project/site --event repository_dispatch --limit 3
```

Expected: a run appears, with `deploy-site` running and `deploy-studio` skipped.

- [ ] **Step 3: Create the webhook**

Sanity's management API needs the CLI's admin credentials, not the read-only token:

```bash
set -a; source .env.local; set +a
SANITY_ADMIN=$(npx sanity debug --secrets 2>/dev/null | grep 'Auth token:' | awk '{print $3}')

curl -s -X POST "https://api.sanity.io/v2021-06-07/hooks/projects/85i3osnk" \
  -H "Authorization: Bearer $SANITY_ADMIN" \
  -H "Content-Type: application/json" \
  -d @- <<JSON | python3 -m json.tool
{
  "name": "Deploy site on publish",
  "description": "Fires repository_dispatch at GitHub Actions",
  "url": "https://api.github.com/repos/softmess-project/site/dispatches",
  "dataset": "production",
  "filter": "_type in [\"siteSettings\", \"homePage\", \"legalPage\"]",
  "projection": "{\"event_type\": \"sanity-publish\"}",
  "httpMethod": "POST",
  "apiVersion": "v2021-03-25",
  "includeDrafts": false,
  "isDisabled": false,
  "headers": {
    "Authorization": "Bearer $GITHUB_TOKEN",
    "Accept": "application/vnd.github+json"
  }
}
JSON
```

The heredoc is unquoted so `$GITHUB_TOKEN` expands. Expected: JSON containing an `id`.

- [ ] **Step 4: Verify the webhook exists**

```bash
curl -s -H "Authorization: Bearer $SANITY_ADMIN" \
  "https://api.sanity.io/v2021-06-07/hooks/projects/85i3osnk" \
  | python3 -c "import sys,json; [print(h['name'], h['url'], 'disabled' if h.get('isDisabled') else 'active') for h in json.load(sys.stdin)]"
```

Expected: one active hook pointing at the dispatches URL.

- [ ] **Step 5: End-to-end test — publish a change and watch it ship**

In the Studio at `https://studio.softmess.de`, edit `Site settings → copyright` (e.g. append a period), publish, then:

```bash
sleep 15 && gh run list --repo softmess-project/site --event repository_dispatch --limit 1
```

Wait for the run to finish, then:

```bash
curl -s https://softmess.de | grep -o "© 2026 softmess project\.\?"
```

Expected: the edited value is live. Revert the edit and confirm it ships back.

- [ ] **Step 6: Record the operational notes in the README**

Append to `README.md`:

```markdown
## Operations

| Task | How |
| --- | --- |
| Edit content | https://studio.softmess.de — publishing redeploys the site in ~1 min |
| Change the schema | Edit `studio/schemaTypes/`, run `pnpm typegen`, commit, push |
| Force a redeploy | `gh workflow run deploy --repo softmess-project/site` |
| Rotate a token | Update `.env.local`, then `gh secret set <NAME> --repo softmess-project/site` |

The Sanity webhook posts `repository_dispatch` to GitHub using a fine-grained
PAT with `Contents: write`. If publishing stops redeploying, that PAT has
most likely expired — check the hook's delivery log in the Sanity dashboard.
```

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: add operations notes"
git push
```

---

## Done criteria

- `pnpm verify` passes on a fresh clone with no secrets and no network access to Sanity.
- `https://softmess.de`, `https://www.softmess.de` and `https://studio.softmess.de` all serve 200; an unknown path serves the 404 page.
- The built site contains no `<script>` tag, no third-party subresource, and no `[bracketed]` placeholder.
- Editing and publishing in the Studio redeploys the site without anyone touching git.
- No token appears anywhere in the public repository's tracked content.
