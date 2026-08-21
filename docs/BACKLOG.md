# Backlog — softmess.de

State after the backlog-clearing pass on `feat/page-builder`.

`pnpm verify` is green: 18 studio tests, 49 site tests, 15 skipped (the live gate).
`pnpm build:site:deploy` **passes** — the real-content gate no longer blocks.

One thing is open, and it is not a code problem.

**§1.1 — the zone cannot reach some hosts over TLS.** Every Worker on a custom
domain in the `softmess.de` zone gets HTTP 525 on outbound TLS to `api.sanity.io`,
`cdn.sanity.io` and `github.com`, while the same code on `workers.dev` reaches all
of them. The preview Worker has moved to workers.dev to get around it; the image
proxy still ships dormant behind a flag (§1.2), because it has to be same-origin
on `softmess.de`. Filed with Sanity, awaiting a reply.

**§1.3 — resolved.** Publishing site content now deploys the site: the Sanity
webhook dispatches `deploy.yml`, verified end to end. Workers Builds is dropped,
having never produced a deployment; its now-unreferenced deploy hook is the one
piece of dashboard cleanup left.

---

## 1. Blocked — needs you or Cloudflare

### 1.1 The zone cannot reach some hosts over TLS — **this is the blocker**

Measured, reproducible, and not a code fault.

A Worker on a custom domain in the `softmess.de` zone gets **HTTP 525** on
subrequests to `api.sanity.io`, `cdn.sanity.io` and `github.com`. An identical
throwaway Worker on `workers.dev` — same account, same colo (FRA), same code —
gets 200 for all of them.

| host                        | `workers.dev` | `preview.softmess.de` |
| --------------------------- | ------------- | --------------------- |
| example.com                 | 200           | 200                   |
| www.sanity.io               | 200           | 200                   |
| cloudflare.com              | 301           | 301                   |
| api.sanity.io               | 200           | **525**               |
| `85i3osnk.api.sanity.io`    | 200           | **525**               |
| `85i3osnk.apicdn.sanity.io` | 200           | **525**               |
| cdn.sanity.io               | 200           | **525**               |
| github.com                  | 200           | **525**               |

What this rules out — each tested directly, not reasoned about:

- **The code.** A raw `fetch()` with _no token at all_ 525s from inside the
  preview Worker.
- **`@sanity/client`.** It succeeds from the workers.dev Worker on `published`,
  `drafts` and `raw` perspectives with the real token.
- **The token.** It is draft-readable: 35 `sanity.previewUrlSecret` documents at
  `perspective=raw`. See §3.1.
- **The query.** Long, multi-line, `+`-encoded — all 200 from workers.dev.
- **`nodejs_compat`.** Adding it to the throwaway Worker changed nothing.
- **Smart Placement.** `placement: {}` on both Workers; responses carry no
  `cf-placement`, and both run in FRA.
- **Retrying.** 12/12 and then 9/9 consecutive failures. A retry-on-5xx wrapper —
  the workaround the old backlog proposed — would not have helped.
- **Staleness.** The Worker deployed before this pass was pre-page-builder code
  still querying `legalPage`; that was a _second_, separate bug, now fixed. The
  525 survives fresh code.

Cloudflare's own docs confirm the mechanism is zone-scoped: the origin
post-quantum setting "affects all outbound connections from the zone you specify
in the API call, **including `fetch()` requests made by Workers on your zone**"
([pqc-to-origin](https://developers.cloudflare.com/ssl/post-quantum-cryptography/pqc-to-origin/)).
With ML-KEM the ClientHello splits across two packets, and origins or middleboxes
that mishandle that answer 525 — which fits the host-dependent pattern exactly.

**That hypothesis has now been tested and eliminated.** `origin_pqe` was set to
`off`, the matrix re-run, and the result was byte-for-byte identical — same four
hosts at 525, pages still 500. It has been **reverted to `supported`**, its
original value. Post-quantum key agreement is not the cause.

(Method note, since the docs disagree with the API: `PUT` works on
`/zones/{zone}/cache/origin_post_quantum_encryption`; `PATCH` is rejected with
`10405 Method not allowed for this authentication scheme`, which reads like a
permissions error and is not one.)

Other zone state, all checked and none of it suspicious: `pq_keyex` `on`, `ssl`
`full`, `min_tls_version` 1.0, `orange_to_orange` `off`, **no Worker routes on the
zone at all**, and `placement: {}` on both Workers.

**Remaining path: a Cloudflare support ticket.** The whole ticket is the table
above plus the fact that the same script on `workers.dev` works. Failing ray IDs,
all FRA, captured after the `origin_pqe` revert:

```
a2c996919d09c0d5-FRA
a2c99693fd13dcce-FRA
a2c99695caf33d4d-FRA
```

Note for whoever writes it: `github.com` failing alongside the Sanity hosts is the
detail that makes this obviously not a Sanity problem, and `example.com` /
`cloudflare.com` / `www.sanity.io` succeeding from the same Worker in the same
request rules out a blanket egress block.

**Mitigated, not fixed.** The preview Worker now runs on
`softmess-preview.9dev.workers.dev`, which is not on the zone and reaches
api.sanity.io normally, so previews render again. The `/api/diag` route is gone
with the investigation that needed it.

Moving cost the Cloudflare Access perimeter, which cannot bind to workers.dev.
The draft-mode cookie carries `PREVIEW_DRAFT_SECRET` instead of a bare `1` to
replace it (`site/src/lib/draft.ts`), and `site/test/live.test.ts` asserts both
that a forged cookie is refused and that the real secret is honoured.

It cost a second thing that took much longer to spot: the cookie stopped being
same-site with the Studio, which broke Presentation in every browser until it
was partitioned. See §3.6.

Filed with Sanity — this account has no Cloudflare support channel, and their
API endpoints not offering `X25519MLKEM768` is the property that correlates
with the failure. Awaiting a response. The zone fault itself is unchanged, so
§1.2 stays blocked; if it is ever fixed, moving back to `preview.softmess.de`
is a one-line change in `site/wrangler.preview.jsonc` plus the Studio origin.

**Before blaming the 525 for the preview pages' 500, redeploy.** The preview
Worker was being deployed with no `SANITY_PROJECT_ID`: the adapter-generated
`dist/server/wrangler.json` carried `"vars": {}`, and since `deploy-preview`
deliberately runs without `--config`, each deploy cleared the Worker's
plain-text vars. `@sanity/client` then throws `Configuration must contain
'projectId'` at module load — a 500 on every route, with the same symptom as
the 525. `wrangler.preview.jsonc` now declares those vars, so a fresh deploy
tells the two apart: pages that render mean the vars were the cause and this
item shrinks to `/cdn/*`; pages that still 500 confirm the 525 reaches them.
The `/api/diag` measurements are unaffected either way — that route imports no
Sanity client, so it ran fine and its numbers stand.

**Fallback if Cloudflare is slow:** move the preview Worker to `workers.dev`,
where egress demonstrably works. It costs a hostname in
`SANITY_STUDIO_PREVIEW_ORIGIN` and `allowOrigins`, and the draft cookie already
does `SameSite=None; Secure` over https. This unblocks preview but **not** the
image proxy, which has to run on `softmess.de`.

### 1.2 The image proxy is behind a flag, and the flag is off

Resolved by gating rather than waiting. `PROXY_IMAGES` controls whether the
static build emits same-origin `/cdn/*` image URLs or direct `cdn.sanity.io`
ones, and **it defaults to off**, so `main` is safe to deploy at any time.

The default is load-bearing, not caution: `/cdn/*` only works if the Worker can
reach `cdn.sanity.io`, which is exactly what §1.1 breaks.

Both shapes are tested. `pnpm test` sets `PROXY_IMAGES=1`, so the offline gate
covers the proxied path; `pnpm build:site:deploy` inherits the ambient value, so
it covers whatever production actually ships. `dist.test.ts` asserts the matching
shape either way, including which origins its third-party allowlist permits.

**When Cloudflare fixes §1.1**, this is the whole change: set `PROXY_IMAGES=1` in
the build environment, redeploy, run `SITE_URL=… pnpm verify:live` to confirm
`/cdn` serves images, and then delete the privacy-policy paragraph in §1.5.

### 1.3 Publishing deploys the site — resolved

**Decision: GitHub Actions deploys all three Workers. Workers Builds is dropped.**

Workers Builds was the previously chosen mechanism and never produced a single
deployment. Every deployment of `softmess`, `softmess-preview` and
`softmess-studio` reads `"source": "wrangler"` — the deploy hook posts into
something unconfigured, and the build config behind it is dashboard-only, so it
cannot be reviewed, diffed, or fixed from the repo.

`.github/workflows/deploy.yml` already does the whole job: three jobs, one per
Worker, each ending in `wrangler deploy`, all driven from one place. It was run
end to end on 2026-08-18 with `target=all` and deployed all three. Keeping it is
strictly better than Workers Builds here:

- Workers Builds is **per-Worker**, so three Workers means three dashboard
  configs duplicating build commands that already live in `deploy.yml`.
- It builds **independently of `verify`**, so a commit the test gate rejected can
  still ship. `deploy.yml` deploys the commit CI just tested.
- The build environment — `SANITY_STUDIO_PREVIEW_ORIGIN`, `SANITY_API_TOKEN`, the
  Cloudflare credentials — already lives in GitHub.
- Its one real advantage, publish→rebuild without CI, is already covered by
  `repository_dispatch`.

**Done, and verified end to end on 2026-08-18.** Webhook `LRnvr01wjiGvxTgh`,
renamed `GitHub Actions`, now posts to
`https://api.github.com/repos/softmess-project/site/dispatches`:

| field             | value                                      |
| ----------------- | ------------------------------------------ |
| Method            | `POST`                                     |
| `rule.projection` | `{"event_type": "sanity-publish"}`         |
| Header            | `Accept: application/vnd.github+json`      |
| Header            | `Authorization: Bearer <fine-grained PAT>` |
| `dataset`         | `production`                               |

The payload projection lives at **`rule.projection`**, not the top-level
`projection` field — that one validates as an object with no permitted keys and
rejects a GROQ string on every API version. Same trap as `rule.filter` below.

A content-identical mutation to `siteSettings` produced: webhook delivery
`204` (GitHub's success code for `dispatches`; the old Cloudflare hook returned
`200`, so the two are distinguishable in `sanity hooks logs`), a
`repository_dispatch` run two seconds later, and a successful `deploy-site`.

The token is a fine-grained PAT scoped to this repo. Sanity does not read header
values back, so rotating means replacing the header, not recovering it.

The type filter the old backlog asked for is live on that webhook:

```groq
_type in ["homePage", "page", "siteSettings"]
```

Set as `rule.filter`, not the top-level `filter` field — that one expects an
object in this API version and rejects a GROQ string. Verified against the
dataset: it matches the two `page` documents, `homePage` and `siteSettings`, and
skips `sanity.imageAsset`, `system.group` and `system.retention`, all of which
used to trigger a build for nothing. `includeDrafts: false` was already correct.

`.github/workflows/deploy.yml` serves both paths: `workflow_dispatch` with a
target of all/site/preview/studio for manual deploys, and
`repository_dispatch: [sanity-publish]` on `deploy-site` for the publish hook.

`dataset` is now `production` rather than `*`, so a future staging dataset will
not trigger production deploys.

**Left over:** the Cloudflare Workers Builds deploy hook
(`daf1fb82-9012-42a5-8718-f3a974457a0b`) and whatever build config sits behind it
are now unreferenced and should be deleted in the dashboard. While it is still
connected, the Workers dashboard also _misattributes_ version history: it joins
versions to GitHub commits and credits `b87b3872` to `dependabot[bot]`, where the
version's own API record reads `author_email: moritz@mazetti.me`.

### 1.3a Add `client_payload` to the webhook projection — one field, and CI is waiting for it

`deploy.yml` now names the publisher in the Cloudflare version message, but only
if the webhook sends one. Extend the projection at `rule.projection` from
`{"event_type": "sanity-publish"}` to:

```groq
{
  "event_type": "sanity-publish",
  "client_payload": {
    "author": identity(),
    "type": _type,
    "slug": slug.current
  }
}
```

`identity()` yields a project-scoped user id (`pA22gx9IC`), which
`deploy-site` resolves through
`GET api.sanity.io/v2021-06-07/projects/85i3osnk/users/{id}` using the
`SANITY_API_TOKEN` it already holds. Verified against the live project: that id
returns `Moritz Mazetti`, and robot ids resolve too. `slug.current` is null on
the singletons, which is fine — every part is optional and the message degrades
one piece at a time, from
`Sanity publish by Moritz Mazetti (page/impressum, 5d86c6f, run 123)` down to
`Sanity publish (5d86c6f, run 123)`.

**Edit it, do not recreate it.** `sanity hooks` has list, create, delete and
logs, but no edit verb, and deleting loses the `Authorization: Bearer <PAT>`
header — Sanity never reads header values back.

Note what this does _not_ fix: Cloudflare's "by" column. That is
`metadata.author_email`, taken from the credential that uploaded the version,
and an API token carries no user identity, so CI deploys read `by Unknown`
whatever the message says. Deploying under a user credential instead would make
CI deploys indistinguishable from local ones, which is worse.

### 1.4 The imprint address, and a DPA with Sanity

Both were deferred by you, and both are recorded as accepted rather than fixed:

- The imprint still carries `TBD` where a street and postcode belong. A `§ 5 DDG`
  imprint without an address is not compliant. The build no longer blocks on it
  (§4.1 below), so nothing will remind you.
- The privacy policy names Sanity as a processor with no
  Auftragsverarbeitungsvertrag on file.

### 1.5 One paragraph of the privacy policy to delete — but not yet

Do this **only** after `PROXY_IMAGES=1` actually ships (§1.2). Until then the
disclosure is accurate and must stay.

The policy discloses that a visitor's IP reaches Sanity when an image loads.
After §5 that is no longer true — images come from our own origin. The text lives
in Sanity (`Datenschutz` page), not in this repo, so delete that passage in the
Studio. Do it when 1.1 is fixed and the proxy actually ships, not before.

### 1.6 Put Cloudflare Access in front of `preview.softmess.de` — **one field, and it closes a live hole**

Today `preview.softmess.de` is a public custom domain that answers anonymous
requests, and `isDraftMode` accepts any request carrying `sanity-draft-mode=1` —
the literal constant the handshake sets. So
`curl -H 'Cookie: sanity-draft-mode=1' https://preview.softmess.de/` returns
every unpublished draft plus the stega payloads. The `validatePreviewUrl`
handshake protects nothing once anyone has seen the cookie's shape.

The design spec asked for a _signed_ cookie. Access was chosen instead: it moves
the gate to the perimeter, matches how `softmess.de` is already protected, and
needs no crypto in the Worker. The code side is done — `draft.ts` records why the
bare `1` is acceptable behind a perimeter, and `live.test.ts` now asserts the
gate is up, so removing Access fails the live gate instead of silently
re-opening the hole.

**What is left is one dashboard change.** In **Zero Trust → Access →
Applications** (team domain `feinschliff-studio.cloudflareaccess.com`), open the
existing `softmess.de` application and add `preview.softmess.de` as an
additional domain. That inherits the policy already protecting the public site,
so there is no second policy to keep in sync and no identity decision to make.

Not done from here because the API token in `.env.local` lacks Access
permissions: `access/groups` and `access/organizations` both answer
`Authentication error`, and `access/apps` reports an empty list even though
`softmess.de` visibly redirects to the Access login. Creating an application
blind would mean guessing the identity provider and the allowed identities —
which either locks the editor out or leaves the host open.

**Know this before you turn it on:** the Studio loads the preview host in an
iframe, and Access answers an unauthenticated request with a redirect to a login
page that will not render usefully inside that frame. Log in to
`https://preview.softmess.de/` once in a normal tab; the `CF_Authorization`
cookie is same-site with `studio.softmess.de` (shared registrable domain), so
the iframe then carries it.

To verify: `LIVE=1 pnpm verify:live`. The gate assertion runs unauthenticated;
the four assertions behind it need `PREVIEW_COOKIE='CF_Authorization=…'` copied
from a logged-in browser, and skip without it.

### 1.7 Two Studio edits the seo-social-metadata branch needs from you

Merging that branch does not, by itself, achieve two of its four headline
goals on the live site. Both need one edit in the Studio; neither is a code
change, so nothing here will fail a build to remind you.

**Set the home page's language.** _Startseite → Suchmaschinen → Sprache_ →
**Englisch**. Until this is set, production still renders `lang="de"` on the
English home page — every visible string on it is English, and the tag
claims otherwise. The code default is `de`, deliberately: `initialValue` only
ever applies to newly created documents, so a document that already exists
reads as unset regardless of what the field's default says. Defaulting the
_code_ to `en` would have silently relabelled the German imprint and privacy
policy on the next build — the wrong direction to be wrong in. `de` preserves
exactly what ships today; setting the home page to Englisch is the one
deliberate edit that makes the tag true again.

~~**Upload the site icon.**~~ Done, and the field is gone with it: the icon
set is five static files in `site/public/`, generated in one pass, not content.
The _Website-Icon_ field could only ever produce one square PNG, while the set
needs a multi-resolution `.ico`, an opaque apple-touch icon and two
`purpose: maskable` manifest icons with their own safe-zone padding — five
different preparation rules, none of them an editor's job. Removing it also
removed the machinery that existed only to survive an empty field: `lib/icon.ts`
with its 1×1 placeholder PNG, the two prerendered endpoints, and the
`accept: image/png,image/jpeg` filter working around Sanity never rasterizing
SVG. `Organization.logo` is now unconditional. Changing the icon means
regenerating the set and deploying — which was true before, since a new icon
needs all five variants regardless.

Two smaller, unrelated notes from the same review:

- `og:image:width` is declared as `1200`, but Sanity's rect-crop rounding can
  deliver `1199×630` for some source aspect ratios. Harmless — scrapers
  measure the actual bytes rather than trusting the tag — but the declared
  value is a hint, not a guarantee.
- ~~Prettier is a devDependency of `studio/` only and is not wired into
  `pnpm verify`.~~ Closed. Prettier and `prettier-plugin-astro` are root
  devDependencies, the duplicated config in `studio/package.json` is gone in
  favour of the one at the root, and `pnpm format:check` is the first step of
  `pnpm verify`. The 19 files that had drifted are formatted; 52 more under
  `.superpowers/` and `docs/superpowers/` are ignored as session artifacts and
  superseded design records rather than churned.
  Two things the pass turned up: prettier's default `trailingComma` applies to
  `.jsonc`, and while wrangler tolerates trailing commas, `dist.test.ts` reads
  `wrangler.jsonc` with strict `JSON.parse`, so `*.jsonc` is pinned to `"none"`.
  And `prettier-plugin-astro` rewrites `<div></div>` to `<div />`; Astro's
  compiler expands it back, verified against the built HTML, so it is cosmetic —
  but that is worth knowing before reading such a diff as a bug.

### 1.8 The fediverse account WebFinger is holding a place for

`/.well-known/webfinger` publishes two subjects — `acct:softmess@softmess.de`
and `acct:moritz@softmess.de` — and answers RFC 7033 queries for both. What it
cannot yet do is the reason most people set WebFinger up: make
`@moritz@softmess.de` followable in Mastodon and everything else speaking
ActivityPub. That needs an account to point at, and there isn't one.

When there is, the change is entirely in
`site/src/pages/.well-known/webfinger.ts` — `src/worker.ts` matches on whatever
subjects the built documents declare and knows none of them by name. Two links
go on the **personal** document, not the org one:

```ts
{rel: 'self', type: 'application/activity+json', href: '<the account's actor URL>'},
{rel: 'http://ostatus.org/schema/1.0/subscribe',
 template: '<the host's authorize_interaction URL>?uri={uri}'},
```

Two things worth knowing before doing it. The remote server has to be told to
accept the alias — on Mastodon that is _Preferences → Profile → Aliases_, plus
the redirect the account itself advertises; publishing the JRD alone gets you a
handle that resolves and then fails to follow. And `subscribe` uses `template`
rather than `href`, which is legal JRD and is the only link in the document
shaped that way — so that commit also has to relax two things written for an
all-`href` document: `dist.test.ts`'s "gives every link an absolute href", which
would read `undefined` off it, and the `Jrd` type in `src/worker.ts`, where
`href` is required.

The Instagram `rel="me"` deliberately stays on the org document only:
`rel="me"` asserts that two URIs are the same entity, and that account is the
project's. `dist.test.ts` guards the direction that overclaims by accident — an
org account leaking onto the _personal_ subject — and cannot see a personal
account added to the org document, so that one is on the author.

---

## 2. Answered

### 2.1 Document-history retention: 90 days

`maxRetentionDays: 90`, `activityFeedEnabled: true`. That is the real undo
window, and it settles the fifth usability trap.

### 2.2 The usability session and the browser preview checks

Reported as passed. Per the plan's own branch conditions, that means the
remaining work is publishing automation and reload-free preview stays declined —
the Next.js question does not reopen.

---

## 3. Done this pass

### 3.1 A draft-readable Sanity token — done

The old backlog's last blocker on local preview. The token now in `.env.local`
and `site/.dev.vars` returns **35** `sanity.previewUrlSecret` documents at
`perspective=raw` (it measured 0 with the old deploy-only token). The same token
is live on the preview Worker as a secret, and is now also a GitHub Actions
secret.

### 3.2 CI deploy jobs — done

`deploy-site`, `deploy-preview`, `deploy-studio` in `.github/workflows/deploy.yml`,
SHA-pinned to the same actions `verify.yml` uses. Two opposite rules are encoded
there, both learned by breaking them:

- **`deploy-site` must pass `--config`.** `@astrojs/cloudflare` leaves a deploy
  redirect at `site/.wrangler/deploy/config.json` after any preview build in the
  same workspace, and wrangler follows it by default — which would deploy the SSR
  preview app onto `softmess.de`.
- **`deploy-preview` must not.** The adapter writes the deployable config to
  `dist/server/wrangler.json`; passing `--config wrangler.preview.jsonc` uploads
  `entry.mjs` without its chunks, reports success, and then 404s every route.
  **That is what had actually been deployed** — a 1.77 KiB "SSR" Worker.

Also fixed here: the adapter was generating the preview Worker's config from the
default-named `wrangler.jsonc`, i.e. the _static_ site's, name `softmess`, routed
at `softmess.de`. `astro.config.mjs` now names `wrangler.preview.jsonc` via
`configPath`. And `session: false`, because nothing here has a session and the
default made wrangler try to auto-provision a KV namespace.

Repository secrets set: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`SANITY_API_TOKEN`. Variable set: `SANITY_STUDIO_PREVIEW_ORIGIN`.

### 3.3 `verify:live` — done

`pnpm verify:live`. Asserts the preview host renders, leaks no stega marker
without the draft cookie, and refuses a handshake with no secret; and, given
`SITE_URL`, that the public site names no third-party origin and serves images
through `/cdn`. Skipped unless `LIVE=1`, so the offline gate is unchanged.

It currently fails on exactly one assertion — preview returning 500 — which is
§1.1 and is the correct result.

Its `/cdn` assertions are gated on `PROXY_IMAGES`, matching `dist.test.ts`: with
the flag off they would otherwise fail against a correct deploy. Export the same
value the deployed build used when running it.

`SITE_URL` is opt-in because `softmess.de` sits behind **Cloudflare Access** and
answers an unauthenticated request with a redirect to a login page. Worth knowing:
the old backlog described the site as "live and working"; it is gated.

### 3.4 The seed package — deleted

Both images were already in Sanity, byte-identical (365598 and 633599), and
`migrate.ts` was inert. The dataset export is the restore path now. This also
retired the old §4.2 and §4.3 (orphaned `legalPage` docs, footer not relinked).

### 3.5 Papercuts — done

- `pnpm typegen` no longer prints "Encountered errors in 1 file". Every query is
  defined in `site/src/lib/content.ts`, so the extractor's glob is `*.ts` and it
  no longer parses `.astro` frontmatter it cannot handle. Files evaluated: 27 → 11.
- `getNav` hard-fails on a missing `siteSettings`, like `getSiteSettings` and
  `getHomePage`, instead of silently returning an empty nav.
- The duplicated variant-map comment was already gone; the explanation lives in
  `variants.ts`.
- Adding a third call-to-action already didn't fail the build.

### 3.6 Presentation showed a generic error in every browser — fixed

The symptom was "An error occurred / Could not connect to the preview", with
`Unable to connect to visual editing` in the console, in Safari, Chrome and
Chrome Incognito alike.

**Nothing was wrong with the server, and that is what made it expensive.** All of
this was measured against the deployed hosts before the cause was found: the
handshake returned `307` with a `Set-Cookie`; that cookie really did turn on
drafts and emit stega; every one of the five client chunks served with hashes
matching a local build; the island module loaded under a DOM shim without
throwing; the Worker had all four bindings; the Studio bundle inlined the right
origin; `allowOrigins` parsed to `URLPattern`s that match the frame origin; and
the Studio had successfully created preview secrets minutes before.

The cookie was being discarded by the **browser**. The Studio frames the preview
from `studio.softmess.de` while the Worker runs on `workers.dev`, so the draft
cookie is a third-party cookie. `SameSite=None` lets a cookie be _sent_
cross-site; it does not stop the browser blocking it as third-party, which
Safari does unconditionally and Chrome does in Incognito and wherever the user
has turned third-party cookies off. Draft mode therefore stayed off,
`Base.astro` rendered no visual-editing island — the page shipped **no script at
all** — and Presentation timed out waiting for a connection that could never
come.

The fix is `partitioned: secure` on the cookie (CHIPS), in
`site/src/preview-routes/draft-mode-enable.ts`. Partitioning keys the cookie to
the embedding site, which exempts it from that blocking, and it _narrows_ the
gate rather than widening it: the cookie is no longer sent from any other
embedder. Caveat worth keeping: CHIPS needs Safari 18.4 or newer. If §1.1 is
ever fixed and preview moves back onto a `softmess.de` subdomain, the cookie is
same-site again and none of this matters.

**Why the live gate did not catch it, and what changed.** `fetch()` has no
cookie policy, so every assertion in `live.test.ts` passed against a Presentation
tool that was broken for editors — and nothing exercised the handshake's
_success_ path at all. It now mints a real `sanity.previewUrlSecret`, drives the
handshake against the deployed Worker, asserts `307` plus all four cookie
attributes as a set, and deletes the document afterwards. Verified as a real
test: it fails on the missing `Partitioned` against the pre-fix deploy. It needs
`SANITY_API_TOKEN` and skips without one.

**One loose end, deliberately not acted on.** The preview origin
`https://softmess-preview.9dev.workers.dev` is not in the project's CORS
allowlist, while the dead `https://preview.softmess.de` still is. That is stale
rather than broken: the preview client bundle names no Sanity API host at all —
checked — because every query runs server-side in the Worker, so the frame never
makes a browser-side call that CORS could reject. Adding the entry would be
tidying, not a fix; removing the dead one is the more useful half.

---

## 4. Deliberate non-goals, recorded so they stop resurfacing

### 4.1 The real-content gate does not check content

`pnpm build:site:deploy` passes with the imprint's `TBD` in place, by design
(`c63e638`). Every assertion about _what content says_ — exact copy, block
counts, nav labels, unfilled placeholders — is fixture-only, because real content
is edited in the Studio and pinning it turns ordinary editing into a broken build.

What it still enforces against real content: every route present, each page has a
title and description, a non-empty hero heading, exactly one `h1`, Portable Text
renders headings/paragraphs/mailto links, **no third-party subresource**, no
JavaScript, canonical and trailing-slash agreement, and no preview hostname in
the output.

The consequence is that **nothing will fail when the imprint is still `TBD`**.
That is a deliberate trade, not an oversight — see §1.4.

### 4.2 The preview Worker keeps direct `cdn.sanity.io` image URLs

It is editor-only and never public, so the privacy argument behind §5 does not
apply, and a second proxy route would buy nothing.

### 4.3 SEO work deliberately deferred to the blog and the catalog

`docs/superpowers/specs/2026-08-20-seo-social-design.md` §11 has the detail.
Not built, and not because it was overlooked:

- **`<lastmod>` in the sitemap.** `sitemap.xml.ts` argues against it for three
  routes and search engines discount an unverifiable value. It becomes worth the
  cost when `_updatedAt` means something — i.e. when there are posts.
- **RSS/Atom, `Article` JSON-LD, `og:type=article`.** Nothing to put in a feed
  yet. All three plug into `lib/seo.ts` as a new `OgType` and a fourth node
  appended inside `siteGraph`; `Base.astro`'s head does not move again.
- **`Product` JSON-LD.** Blocked on a commercial question, not a technical one:
  is there a price, is there stock, does a visitor buy on-site or by Instagram
  DM. `Offer` follows from that answer and earns nothing before it.
- **`BreadcrumbList`.** The one structured-data type here that _would_ earn a
  Google rich result — and the site is flat, so there is no trail to describe.
  It becomes real the moment a post or catalogue route nests below a section,
  and joins the existing `@graph` the same way.
- **`hreflang`.** The site is mixed-language by design — the German imprint is
  not an alternate of the English home page — so there are no alternate pairs to
  declare. This refines `2026-08-16-page-builder-design.md`, which asserted the
  site is German throughout; that was true of the Studio, never of the copy.
- **A separate wordmark for `Organization.logo`.** `logo` points at
  `/web-app-manifest-512x512.png`, so the square app icon serves as both favicon
  and logo. A knowledge panel would rather have the wordmark; that is another
  static file and a one-line change in `lib/seo.ts` if it ever matters.
- **Generated social cards.** Compositing text onto an image needs a rasterizer
  at build time and Sanity's image API cannot do it. The per-page `ogImage`
  field covers the case that matters.

### 4.4 Migrating from Prettier + ESLint to Biome

Proposed for build speed, measured, and declined. The numbers do not support the
premise: Prettier over the whole repo is 1.9s and ESLint on `studio/` is 1.7s,
against a `pnpm verify` of ~23s. Linting and formatting are 16% of the gate — the
cost is the fixture Astro build plus two vitest runs, and Biome touches neither.
Best case it saves ~3s of 23s and nothing at all off `pnpm build:site`.

Against that, three things measured against Biome 2.5.9 on this repo's own files:

- **Markdown is not supported.** `biome check README.md` reports
  `Checked 0 file`. `CLAUDE.md`, `README.md` and this file would stop being
  formatted.
- **`.astro` is parsed as frontmatter only, and the linter is wrong about it.**
  On `Base.astro` it flags `Header` and `Footer` as `noUnusedImports` and `graph`
  and `VisualEditing` as `noUnusedVariables` — all four are used in the template
  it cannot see, and all are marked `FIXABLE`, so `--write` would delete the
  imports the page renders with. The formatter likewise leaves template markup
  alone, which is most of the file and the part `prettier-plugin-astro` was added
  to cover.
- **`@sanity/eslint-config-studio` has no Biome equivalent.** The Studio's rules
  would simply be dropped.

Revisit if Biome ships real Astro template support, or if this repo grows enough
TypeScript that 1.9s becomes minutes. Neither is close.

### 4.5 Two toolchain upgrades the ecosystem is not ready for

Both were attempted, both failed against the actual tools, and both are pinned
one version short of latest on purpose. `pnpm -r outdated` will keep offering
them.

**TypeScript 7 — no.** `typescript-eslint@8.67.0` refuses to load at all:
`typescript-eslint does not support TS 7.0`, pointing at typescript-eslint#10940
for `>=7.1` support. Independently, `astro check` crashes in
`@astrojs/language-server@2.16.14` constructing `AstroCheck`. TypeScript is on
**6.0.3** instead — the newest release typescript-eslint's peer range
(`>=4.8.4 <6.1.0`) admits, and it passes the whole gate including `astro check`
and the preview build. Revisit when typescript-eslint ships TS 7 support.

**eslint 10 for `studio/` — no.** `@sanity/eslint-config-studio@6.0.0` (latest)
declares `eslint: ^9.0.0` and pulls `eslint-plugin-react@7.37.5`, also latest,
whose peer range ends at `^9.7`. On eslint 10 the run dies with
`Error while loading rule 'react/no-direct-mutation-state': contextOrFilename.getFilename is not a function`
— eslint 10 removed `context.getFilename()`. No override fixes it, because
7.37.5 is the newest eslint-plugin-react that exists. So studio stays on eslint
9.39.5: deprecated upstream, pinned deliberately, until Sanity's config ships an
eslint 10 build.

`site/` is on eslint 10 because `eslint-plugin-astro@3.1.0` requires
`eslint: >=10.0.0`. Its peer set cannot be satisfied in either direction: it also
requires `eslint-plugin-jsx-a11y >=6.10.2`, and 6.10.2 — the latest — caps at
eslint 9. So `pnpm peers check` reports one unmet eslint peer whichever major
site uses; on 10 the unmet one is transitive instead of the direct dependency.

---

---

## 5. The image proxy — built, tested, shipped dormant

`cdn.sanity.io` was the only third-party origin a visitor's browser contacted,
which forced the privacy policy to disclose that their IP reaches Sanity.

No new Worker and no new route: `site/wrangler.jsonc` gained a `main` and
`run_worker_first: ["/cdn/*"]`, so every page, font and stylesheet is still served
straight from assets without running code, and only `/cdn/*` reaches
`site/src/worker.ts`. The route is pinned to this project's id, dataset and
Sanity's single-segment asset paths, so it cannot be an open proxy.

Verified under `wrangler dev` against the real dataset: the hero image returns 200
`image/webp` with Sanity's own `cache-control`, pages still come from assets, a
foreign project id and a traversal both 404, and POST is 405. `dist.test.ts`'s
third-party allowlist no longer exempts `cdn.sanity.io` when the flag is on, so
the built HTML must name no external host at all — and it doesn't.

**Dormant until §1.1 is fixed**, behind `PROXY_IMAGES` (§1.2). The code is in
`main`'s path and fully tested; only the flag is off, because `/cdn/*` cannot work
while the zone can't reach `cdn.sanity.io`.

---

## Appendix — what to run

```bash
pnpm verify              # offline gate: typegen drift, lint both packages, studio typecheck/tests, astro check, site tests
pnpm verify:live         # deployed-host assertions; SITE_URL=... to include the public site
pnpm build:site          # build from live Sanity
pnpm build:site:deploy   # the same build, then the real-content gate
pnpm dev                 # studio + site together, preview mode, site on :4321
```

Deploying by hand, if you need to bypass CI — note the opposite `--config` rules:

```bash
# static site (do not run until §1.1 is fixed — see §1.2)
pnpm build:site:deploy
cd site && npx wrangler deploy --config wrangler.jsonc

# preview Worker — no --config, on purpose
pnpm --filter site build:preview
cd site && npx wrangler deploy

# studio
pnpm build:studio
cd studio && npx wrangler deploy --config wrangler.jsonc
```
