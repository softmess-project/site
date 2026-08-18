**Title:** `fetch()` returns 525 to origins that `connect()` reaches successfully from the same Worker (Custom Domain only)

---

### Summary

On a Worker deployed to a **Custom Domain**, `fetch()` fails with **HTTP 525** to
certain origins. In the *same request*, to the *same host*, `connect(…, {
secureTransport: "on" })` completes a TLS handshake and returns a valid HTTP
response. The byte-identical script on `*.workers.dev` returns 200 for all of
them.

```js
// same Worker, same request, same colo (FRA)
await fetch("https://github.com/")                    // -> HTTP 525
await connect({hostname:"github.com",port:443},
              {secureTransport:"on"})                 // -> HTTP/1.1 200 OK
```

### Scope note

I realise the outbound path for `fetch()` on the edge likely lives outside this repo. I'm filing here because it's the only public tracker for the Workers runtime, and because the interesting part *is* runtime-shaped: two APIs implemented by workerd disagree about whether a host is reachable. Happy to be redirected — I have no support channel (free plan), which is why this is on GitHub at all.

One detail suggesting the fault is edge-side rather than in workerd proper: the 525 arrives **as an HTTP response with its own `cf-ray` header** (`a2cfb2053f6ddc6a-FRA`), not as a thrown network error. So the subrequest is being proxied through infrastructure that synthesises an HTTP response, while `connect()` apparently is not. If `fetch()` and `connect()` take different egress paths on a zone-attached Worker, that asymmetry seems worth documenting even if the fix lands elsewhere.

### Reproduction

```js
export default {
  async fetch() {
    const r = await fetch("https://api.sanity.io/v1/ping");
    return new Response(`status ${r.status}`);
  },
};
```

- deployed to `*.workers.dev` → **200**
- same script on a Custom Domain in a zone → **525**, 100% of the time, 9–91 ms

### Ruled out by measurement

- **Network / reachability** — raw TCP to every failing host succeeds from the zone Worker; a hand-built ClientHello gets a ServerHello back at 300 B, 1700 B and 2500 B. Not MTU, not fragmentation, not an egress block.
- **The origin** — same origins complete a full handshake via `connect()` from the same Worker and return real HTTP responses.
- **Worker code / bindings / credentials** — dependency-free probe Worker, no bindings. A bare `fetch("https://github.com/")` reproduces it.
- **Smart Placement** — `placement.mode = "off"` on both; both run in FRA.
- **Retries** — deterministic, not transient.

### Correlation

Across 11 third-party origins, `fetch()` returns 525 if the origin does not support the `X25519MLKEM768` key agreement group (verified independently with `openssl s_client -groups X25519MLKEM768`, and from the same colo with a PQ-only ClientHello):

| origin | X25519MLKEM768 | fetch() workers.dev | fetch() zone |
| --- | --- | --- | --- |
| pypi.org, aws.amazon.com, www.sanity.io | yes | 200 | 200 |
| github.com, api.stripe.com, sentry.io | **no** | 200 | **525** |
| api.sanity.io, cdn.sanity.io | **no** | 200 | **525** |
| raw.githubusercontent.com | yes | 200 | **525** |

The zone has `cache/origin_post_quantum_encryption = supported`, which per [the docs](https://developers.cloudflare.com/ssl/post-quantum-cryptography/pqc-to-origin/) affects "all outbound connections from the zone … including `fetch()` requests made by Workers on your zone" — matching the observed blast radius exactly, and explaining why `workers.dev` is unaffected.

Two caveats I can't explain: `raw.githubusercontent.com` supports the group and still 525s, and setting `origin_post_quantum_encryption = off` did not change the result. So either the correlation isn't causal, or that setting doesn't apply to Worker `fetch()` on a Custom Domain.

These origins are not misbehaving — offered `X25519MLKEM768` *plus* a classical group they all fall back correctly via HelloRetryRequest.

### Environment

wrangler 4.123.0 · `compatibility_date` 2026-08-15 · no compat flags ·
`placement.mode: "off"` · colo FRA · zone `ssl=full`, `tls_1_3=zrt`,
`min_tls_version=1.0`, `orange_to_orange=off`, no Worker routes on the zone.

Failing rays (all FRA): `a2cfb2030d7fdc6a`, `a2cfb204ff19dc6a`,
`a2cfb2053f6ddc6a`, `a2cfb2059fcedc6a`.
