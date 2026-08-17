# Backlog — softmess.de

State after the backlog-clearing pass on `feat/page-builder`.

`pnpm verify` is green: 18 studio tests, 43 site tests, 8 skipped (the live gate).
`pnpm build:site:deploy` **passes** — the real-content gate no longer blocks.

**One thing blocks launch and it is not in this repo.** Every Worker on the
`softmess.de` zone gets HTTP 525 on outbound TLS to some third-party hosts. That
breaks the preview Worker and it will break the new image proxy the moment the
static site is deployed. It is §1.1, and it needs Cloudflare, not a commit.

---

## 1. Blocked — needs you or Cloudflare

### 1.1 The zone cannot reach some hosts over TLS — **this is the blocker**

Measured, reproducible, and not a code fault.

A Worker on a custom domain in the `softmess.de` zone gets **HTTP 525** on
subrequests to `api.sanity.io`, `cdn.sanity.io` and `github.com`. An identical
throwaway Worker on `workers.dev` — same account, same colo (FRA), same code —
gets 200 for all of them.

| host | `workers.dev` | `preview.softmess.de` |
| --- | --- | --- |
| example.com | 200 | 200 |
| www.sanity.io | 200 | 200 |
| cloudflare.com | 301 | 301 |
| api.sanity.io | 200 | **525** |
| `85i3osnk.api.sanity.io` | 200 | **525** |
| `85i3osnk.apicdn.sanity.io` | 200 | **525** |
| cdn.sanity.io | 200 | **525** |
| github.com | 200 | **525** |

What this rules out — each tested directly, not reasoned about:

- **The code.** A raw `fetch()` with *no token at all* 525s from inside the
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
  still querying `legalPage`; that was a *second*, separate bug, now fixed. The
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

To reproduce at any time: `curl https://preview.softmess.de/api/diag` (temporary
route, `site/src/pages/api/diag.ts`, delete with this item).

**Fallback if Cloudflare is slow:** move the preview Worker to `workers.dev`,
where egress demonstrably works. It costs a hostname in
`SANITY_STUDIO_PREVIEW_ORIGIN` and `allowOrigins`, and the draft cookie already
does `SameSite=None; Secure` over https. This unblocks preview but **not** the
image proxy, which has to run on `softmess.de`.

### 1.2 Do not deploy the static site until 1.1 is fixed

`deploy-site` is wired and works, but the site now serves images through
`/cdn/*` (§5), and that path fetches `cdn.sanity.io` — which 525s from this zone.
Deploying today would break every image on the site.

Currently deployed to `softmess.de` is the older assets-only build
(`has_modules: false`), which still points at `cdn.sanity.io` directly and is
therefore fine.

### 1.3 Publishing automation — settled on Cloudflare Workers Builds

Resolved. **Cloudflare Workers Builds is the mechanism**, and the GitHub route was
not built out, so only one thing deploys on publish.

The live Sanity webhook `Cloudflare` (id `LRnvr01wjiGvxTgh`, pointing at a Workers
Builds deploy hook) now carries the type filter the old backlog asked for:

```groq
_type in ["homePage", "page", "siteSettings"]
```

Set as `rule.filter`, not the top-level `filter` field — that one expects an
object in this API version and rejects a GROQ string. Verified against the
dataset: it matches the two `page` documents, `homePage` and `siteSettings`, and
skips `sanity.imageAsset`, `system.group` and `system.retention`, all of which
used to trigger a build for nothing. `includeDrafts: false` was already correct.

`.github/workflows/deploy.yml` therefore serves **manual** deploys —
`workflow_dispatch` with a target of all/site/preview/studio. Its `deploy-site`
job also accepts `repository_dispatch: [sanity-publish]`, which nothing fires; it
is left in place as the escape hatch if Workers Builds is ever dropped. Note that
`repository_dispatch` only triggers workflows on the **default branch**, so that
path needs `deploy.yml` on `main` before it could work at all.

Still worth a thought, not done: the hook's `dataset` is `"*"`. With one dataset
that is harmless, but a future staging dataset would trigger production deploys.

### 1.4 The imprint address, and a DPA with Sanity

Both were deferred by you, and both are recorded as accepted rather than fixed:

- The imprint still carries `TBD` where a street and postcode belong. A `§ 5 DDG`
  imprint without an address is not compliant. The build no longer blocks on it
  (§4.1 below), so nothing will remind you.
- The privacy policy names Sanity as a processor with no
  Auftragsverarbeitungsvertrag on file.

### 1.5 One paragraph of the privacy policy is now wrong in your favour

The policy discloses that a visitor's IP reaches Sanity when an image loads.
After §5 that is no longer true — images come from our own origin. The text lives
in Sanity (`Datenschutz` page), not in this repo, so delete that passage in the
Studio. Do it when 1.1 is fixed and the proxy actually ships, not before.

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
default-named `wrangler.jsonc`, i.e. the *static* site's, name `softmess`, routed
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

---

## 4. Deliberate non-goals, recorded so they stop resurfacing

### 4.1 The real-content gate does not check content

`pnpm build:site:deploy` passes with the imprint's `TBD` in place, by design
(`c63e638`). Every assertion about *what content says* — exact copy, block
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

---

## 5. The image proxy — built, tested, not yet deployable

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
third-party allowlist no longer exempts `cdn.sanity.io`, so the built HTML must
name no external host at all — and it doesn't.

**It cannot ship until §1.1 is fixed.** See §1.2.

---

## Appendix — what to run

```bash
pnpm verify              # offline gate: typegen drift, studio lint/typecheck/tests, astro check, site tests
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
