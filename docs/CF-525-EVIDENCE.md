# HTTP 525 on Worker `fetch()` from a custom-domain zone

Evidence package for a Cloudflare support ticket. Measured 2026-08-18, colo FRA,
account `e0542a0d4f2b1a7df8aa4600e792dbe3`, zone `softmess.de`
(`7ace224ab1450f917eeeb48863ae630f`).

## Summary

A Worker deployed on a **Custom Domain in the `softmess.de` zone** gets
**HTTP 525** on `fetch()` to certain third-party origins. The **byte-identical
script** deployed to **`workers.dev`** reaches all of them with 200.

The failure is not the network, not the origin, and not the Worker code. In the
**same request, from the same Worker, to the same host**, a raw TLS connection
opened with `connect(…, { secureTransport: "on" })` **completes a full TLS
handshake and returns an HTTP response** — while `fetch()` to that same host
returns 525.

**Only `fetch()` fails, and only on the zone.**

## The matrix

Both rows produced by the same script, same minute, same colo (FRA).
`origin PQ` = does the origin negotiate `X25519MLKEM768`, measured from FRA
(probe D below).

| host | origin PQ | `fetch()` workers.dev | `fetch()` zone | raw TLS from zone Worker |
| --- | --- | --- | --- | --- |
| example.com | CF-internal | 200 | 200 | n/a (CF-internal) |
| www.sanity.io | yes | 200 | **200** | HTTP/1.1 200 OK |
| pypi.org | yes | 200 | **200** | HTTP/1.1 200 OK |
| aws.amazon.com | yes | 200 | **200** | HTTP/1.1 200 OK |
| api.sanity.io | **no** (alert 40) | 200 | **525** | HTTP/1.1 200 OK |
| 85i3osnk.api.sanity.io | **no** (alert 40) | 200 | **525** | HTTP/1.1 200 OK |
| 85i3osnk.apicdn.sanity.io | **no** (alert 40) | 200 | **525** | HTTP/1.1 200 OK |
| cdn.sanity.io | **no** (alert 40) | 200 | **525** | HTTP/1.1 200 OK |
| github.com | **no** (alert 40) | 200 | **525** | HTTP/1.1 200 OK |
| api.stripe.com | **no** (alert 40) | 404 | **525** | HTTP/1.1 404 Not Found |
| sentry.io | **no** (alert 40) | 200 | **525** | HTTP/1.1 302 Found |
| raw.githubusercontent.com | yes | 200 | **525** | HTTP/1.1 301 Moved Permanently |

Failing ray IDs (all FRA): `a2cfa7305ea9b18f`, `a2cfa730defeb18f`,
`a2cfa731cfedb18f`, `a2cfa733594cb18f`, `a2cfa7322839b18f`.

## What this rules out

- **Network / egress reachability.** Raw TCP to every failing host succeeds from
  the zone Worker, and a hand-built ClientHello gets a ServerHello back at 300 B,
  1700 B and 2500 B. Nothing is dropped, blocked, or MTU-limited.
- **The origin's TLS.** The same origins complete a full handshake from the same
  Worker via `connect({ secureTransport: "on" })` and return real HTTP responses.
- **Origin overload / rate limiting.** Failures are instant (6–97 ms) and 100 %
  reproducible.
- **Worker code, bindings, tokens, `@sanity/client`.** The probe Worker is a single
  lines with no dependencies and no credentials. A bare `fetch("https://github.com/")`
  525s.
- **Smart Placement.** `placement.mode = "off"` on both Workers; both run in FRA.
- **Sanity specifically.** `github.com`, `api.stripe.com` and `sentry.io` fail
  identically. This is not a Sanity problem.

## Correlation with post-quantum key agreement

Of the 11 non-CF-internal origins tested, **10 follow one rule exactly**:

> `fetch()` from the zone returns 525 **iff** the origin does not support
> `X25519MLKEM768`.

Every origin that answers `handshake_failure` (alert 40) to a PQ-only
ClientHello 525s. Every origin that accepts PQ succeeds. Confirmed independently
from this workstation with `openssl s_client -groups X25519MLKEM768`.

The zone has `cache/origin_post_quantum_encryption = supported`, which per
[Cloudflare's docs](https://developers.cloudflare.com/ssl/post-quantum-cryptography/pqc-to-origin/)
"affects all outbound connections from the zone you specify in the API call,
**including `fetch()` requests made by Workers on your zone**". That is exactly
the blast radius observed, and it explains why `workers.dev` — which is on no
zone — is unaffected.

These origins are not broken: given a ClientHello offering `X25519MLKEM768`
*plus* a classical group, they correctly fall back via HelloRetryRequest
(verified locally — `openssl -groups X25519MLKEM768:X25519:P-256` succeeds
against all of them). Something in Cloudflare's zone-scoped `fetch()` egress
fails to complete that fallback and surfaces it as 525.

**Two caveats, stated honestly:**

1. `raw.githubusercontent.com` supports PQ (from FRA and from here) and still
   525s. So PQ support is not the whole story, or that host's fleet is
   heterogeneous.
2. Setting `origin_post_quantum_encryption = off` was tried in an earlier
   session and **did not change the result**. If the correlation above is
   causal, that means the documented control does not actually take effect for
   Worker `fetch()` on a Custom Domain — which would be a second bug.

## Reproduction

The two probe Workers have been deleted. To redeploy them from the checked-in
sources and reproduce:

```sh
cd docs/tlsprobe
npx wrangler deploy --config wrangler.zone.jsonc   # Custom Domain on the zone
npx wrangler deploy --config wrangler.dev.jsonc    # workers.dev

curl 'https://tlsprobe.softmess.de/?probes=A,B,D&hosts=github.com,api.sanity.io,pypi.org'
curl 'https://tls-probe-dev.<subdomain>.workers.dev/?probes=A,B,D&hosts=github.com,api.sanity.io,pypi.org'
```

Same script, same account, same colo. The first returns 525 for `github.com` and
`api.sanity.io`; the second returns 200 for both.

Probes: **A** `fetch()` · **B** `connect(secureTransport:"on")` + `HEAD /` ·
**C** raw TCP + hand-built ClientHello at 300/1700/2500 B · **D** PQ-only
ClientHello with empty `key_share` (HelloRetryRequest ⇒ supported, alert 40 ⇒ not).

Source and raw results are checked in under `docs/tlsprobe/`:
`src/index.js` (the probe Worker), `wrangler.dev.jsonc` / `wrangler.zone.jsonc`
(the two deploy targets), and `results-workers-dev.json` / `results-zone.json`
(the matched run the table above is built from).

## Ask

**Cloudflare:** why does `fetch()` from a Worker on a Custom Domain fail the TLS
handshake to origins that the same Worker reaches successfully via
`connect()` in the same request? And does
`cache/origin_post_quantum_encryption = off` apply to Worker `fetch()`?

**Sanity (FYI, not a fault report):** `api.sanity.io` and `cdn.sanity.io` do not
offer `X25519MLKEM768`. That is spec-legal, but it is the property that
correlates with this Cloudflare failure. Supporting it would sidestep the issue
for every Sanity customer running Workers on a Cloudflare zone.

## Status

Both probe Workers were deleted after the measurements above were captured. The
raw results they produced are preserved in `docs/tlsprobe/`.
