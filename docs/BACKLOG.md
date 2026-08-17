# Backlog — softmess.de

State at the end of the page-builder / preview-mode work (branch `feat/page-builder`, through `22d20ee`).

The site is **live and working**: `softmess.de` serves German content built from Sanity's page
builder, zero JavaScript, no third-party subresources. The Studio is deployed with Presentation
mode wired to a preview Worker. `pnpm verify` is green — 18 studio tests, 36 site tests.

**One thing deliberately blocks launch** and it is item 1 below. Everything else is follow-up.

---

## 1. Blocked on you — these block launch

### 1.1 The imprint address (blocks the build, on purpose)

`pnpm build:site:deploy` **fails today** and is supposed to. The imprint carries the literal text
`TBD` where a street and a postcode belong, and a `§ 5 DDG` imprint without an address is not
compliant. The placeholder guard fails the deploy build while that text is present.

Fix it in the Studio (`Impressum` page), not in code. The guard clears itself.

-> will be sorted out later, remove these tests from the build entirely

### 1.2 A DPA with Sanity

The privacy policy names Sanity as a processor. Naming a processor without an
Auftragsverarbeitungsvertrag on file is the wrong half of the fix — the disclosure is accurate, the
legal basis is missing.

-> will be sorted out later from a proper template, assume correct for now

### 1.3 German copy review

Every string has a German original now, but the migration carried over what already existed. Worth
one read-through by you, particularly the privacy policy, which was rewritten to be *truthful*
(it now describes what the site actually does — no cookies, self-hosted fonts, images from
`cdn.sanity.io` with the IP consequence spelled out) rather than boilerplate.

**Done.** Reviewed by the owner; Sanity is now the single source of truth. `seed/seed.ts` is deleted
rather than rewritten with lorem ipsum — it duplicated the imprint and the privacy policy as
hardcoded German strings, which is a second source of truth for legally significant wording, and it
still wrote the pre-page-builder `homePage` shape (`heading`/`statement`/`body`/`charm`/`actions`),
fields the schema no longer defines. Running it would have produced a broken home page.

Two leftovers in `seed/`, both harmless but worth a decision:

- `migrate.ts` — the one-shot page-builder migration. Already applied and now inert (a dry run
  proposes 0 mutations). Kept as a record; safe to delete whenever you like.
- `images/charm-red.jpg`, `charm-green.jpg` — the originals, ~1 MB. Both are already uploaded to
  Sanity and `charm-red` is the live hero image, but these are the local source files, so I left them
  alone rather than deleting photos you may not have elsewhere.

To restore content from scratch, the dataset export (`backup-20260817-full.tar.gz`) is the path now,
not a seed script.

### 1.4 Task 11 — the usability session

**This is the checkpoint the whole design waits behind, and I cannot run it.** It is the one
assumption in the plan that can't be recovered from cheaply.

You sit at `pnpm dev` (or `studio.softmess.de/presentation`) and attempt four tasks unaided. Whoever
watches stays **silent** — a hint invalidates the result.

1. Add a new page and give it a sensible address.
2. Make that page reachable from the site's navigation.
3. Reorder two blocks on the home page.
4. Replace a photo.

Five traps to watch for, three of which already have fixes built:

| Trap | Status |
| --- | --- |
| Umlaut in a slug fails validation | Fixed — `slugifyGerman` |
| Page published but linked nowhere | Fixed — orphan warning |
| Edits autosave as a draft, Publish never pressed | **No fix built.** The most common first-time-Sanity failure |
| Partial German in Studio chrome | Bar: nothing you routinely touch is in English |
| No visible undo | Document history — retention still unanswered, see 2.1 |

What the outcome decides:

- **You succeed** → the remaining work is publishing automation (§3), and reload-free preview stays declined.
- **You struggle on preview specifically** → that, and only that, is the evidence that reopens the Next.js question.
- **You struggle on the Studio itself** → no frontend would have helped; the fix is in the schema.

Write the result to `docs/superpowers/notes/`.

---

## 2. Verification I could not do from a terminal

### 2.1 Document-history retention

Your only undo. Retention depends on the Sanity plan and has never been checked. Answer it before
the usability session, since one of the five traps depends on the answer.

### 2.2 Four browser-only preview checks

Everything mechanically checkable about preview has been checked — 12,944 stega markers in draft
HTML versus 0 in published HTML, the overlay island present only when the draft cookie is set, zero
`<script>` in the static build. Those prove the *plumbing*. Four things need an actual browser:

1. Does the Presentation iframe load?
2. Does editing a field update the iframe?
3. Does clicking a heading in the preview focus the right field?
4. Does the Studio form follow navigation in the preview?

Fold these into the usability session — they're the same sitting.

---

## 3. Automation (deliberately deferred)

Everything here was left manual on purpose: prove the workflow by hand first, then automate the
proven workflow.

### 3.1 A draft-readable Sanity token — **this is the last thing blocking local preview**

The token in `site/.dev.vars` is still the **"Deploy Studio"** one: create + read, no update, and —
the part that matters for preview — **it cannot read draft documents**. Sanity keeps the preview-URL
secret in a *draft* system document, so with this token the handshake fails as "invalid or expired
secret" even though the code is now correct. Measured: `count(*[_type == "sanity.previewUrlSecret"])`
at `perspective=raw` returns **20** for an admin token and **0** for this one.

You have already created Editor and Developer robot tokens on the project. Put one of them in:

1. `site/.dev.vars` → `SANITY_API_TOKEN` (local preview), then restart `pnpm dev`.
2. the preview Worker's secrets → `cd site && npx wrangler secret put SANITY_API_TOKEN --config wrangler.preview.jsonc`.

Proven to work end to end once a draft-readable token is in place: enable 307s, sets
`sanity-draft-mode=1`, and the page renders with 15440 stega markers with the cookie and 0 without.

Separately, `.env.local`'s `SANITY_API_TOKEN` is currently commented out, so builds read published
content anonymously. That works today because the dataset is publicly readable — worth knowing rather
than rediscovering.

`migrate.ts` also could not apply with the deploy token; that migration ran via
`sanity exec --with-user-token`.

### 3.2 Publishing automation

Sanity webhook → GitHub `repository_dispatch` → build → `wrangler deploy` of the static site only,
filtered to *published* documents of the types that affect the public site.

### 3.3 Three CI deploy jobs

`deploy-site`, `deploy-preview`, `deploy-studio`, replacing the manual `wrangler deploy` commands
used throughout. Actions SHA-pinned, matching the convention already in `.github/workflows/verify.yml`.

### 3.4 `verify:live`

The draft-leak assertion, run against the deployed preview hostname. Needs secrets, so it cannot
live in the offline `pnpm verify`.

---

## 4. Known defects and papercuts

Ordered by how likely they are to bite you.

### 4.1 preview.softmess.de returns 500 — the deployed preview Worker is down

Every page 500s. The cause is an intermittent **HTTP 525 (SSL handshake failed)** on the Worker's
subrequests to `api.sanity.io`; any one failure throws and kills the render, so it looks total. Which
query fails moves between runs.

What is ruled out, each tested from the Cloudflare edge: the network (all Sanity hosts 200), the URL
(the exact failing URL 200s via plain `fetch`), `@sanity/client` itself (200, both CDN modes),
concurrency (30 concurrent long queries, 0 failures), and the token. The app's own requests carry
nothing unusual — GET, one `authorization` header. Unexplained; needs a Cloudflare support thread with
the ray IDs, or a retry-on-5xx wrapper as a pragmatic workaround.

Consequence for the Studio: `SANITY_STUDIO_PREVIEW_ORIGIN` defaults to `http://localhost:4321`, so the
deployed HTTPS Studio at `studio.softmess.de` tries to iframe an **http** origin and the browser blocks
it as mixed content — which is the "CSP" failure seen there. Point it at `https://preview.softmess.de`
only once the 500 is fixed; until then, local Presentation is the working path.

### 4.2 Adding a third call-to-action no longer fails the build

Fixed. That assertion, and every other one that pinned specific copy, counts or nav labels, is now
fixture-only — see the appendix for what the deploy build still enforces.

### 4.2 `migrate.ts` never deletes the old `legalPage` documents

They were removed by hand. Restore the backup and re-run, and you get orphaned `legalPage` docs
against a schema that no longer defines them. Harmless to the site; confusing to a future reader.

The two dataset exports at the repo root (`backup-20260817*.gz`) are the undo for that migration.
They are now git-ignored rather than committed — keep them somewhere durable if you care about them,
because nothing in the repo protects them.

### 4.3 A partial `migrate.ts` re-run won't relink the footer

Accepted trade-off, not a bug. The script establishes `footerLinks` once and never rebuilds them, so
it can never silently revert your Studio edits — but that also means a re-run that creates a missing
page won't add it to the footer. The create mutation is printed, so it's visible. Incomplete nav
beats silent data loss.

Against the live dataset the script is currently **inert — 0 mutations**.

### 4.4 `pnpm typegen` prints a scary-looking warning that isn't one

`'return' outside of function` in `[slug].astro` — the type extractor's Babel parser rejecting
Astro's perfectly valid top-level frontmatter `return`. Exit code 0, types verified correct. Noise a
maintainer could easily misread as a failure.

### 4.5 `getNav` is inconsistent with its neighbours

Falls back to empty arrays when `siteSettings` is missing, while `getSiteSettings` and `getHomePage`
hard-fail. Unreachable in practice — callers hit `getSiteSettings` first, which throws — so this is
cosmetic.

### 4.6 A duplicated comment across the five block components

The same explanatory comment about variant maps appears in all five block files. It belongs once, in
`variants.ts`.

---

## 5. Wants, not plans

**Proxy `cdn.sanity.io` through our own origin.** It is the only third-party origin the site
contacts, and the privacy policy currently has to disclose that visitors' IPs reach Sanity. Proxying
would remove the disclosure entirely. Recorded as a want — no plan behind it.

---

## Appendix — what to run

```bash
pnpm verify              # offline gate: studio lint/typecheck/tests + astro check + site tests
pnpm build:site          # build from live Sanity
pnpm build:site:deploy   # the same build, then the real-content gate (fails on the imprint TBD)
pnpm dev                 # studio + site together
cd seed && npx tsx migrate.ts   # dry run; MIGRATE_APPLY=1 to write
```

The real-content gate skips four fixture-shaped assertions by design (exact English hero copy, the
five-block fixture count and its ordering, and the sand-variant mapping). What it still enforces
against real content: no placeholder text, no third-party subresources, no JavaScript, canonical and
trailing-slash agreement, footer nav targets, a non-empty hero heading, and exactly one `h1`.
