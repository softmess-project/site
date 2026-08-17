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

-> reviewed and fixed. assume sanity is correct; remove the seed script locally, or replace it with 
   lorem ipsum to avoid hardcoding dynamic copy.

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

### 3.1 A write-scoped Sanity token — **do this first, it blocks the rest**

`SANITY_API_TOKEN` is scoped **"Deploy Studio"** — create + read, no update. `migrate.ts` could not
apply with it; the migration ran via `sanity exec --with-user-token` instead. Any automated content
operation needs a proper Editor-role `SANITY_WRITE_TOKEN`.

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

### 4.1 Adding a third call-to-action will fail the deploy build

`site/test/dist.test.ts` → `renders one button per action` asserts **exactly two** action buttons and
that the second is `mailto:hi@softmess.de`. Add a third CTA in the Studio and `build:site:deploy`
fails on real content. It should assert "at least one, first one filled" instead.

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
