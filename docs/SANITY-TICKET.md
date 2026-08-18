# Sanity API endpoints are unreachable from Cloudflare Workers on a custom domain

## Ask

Please set `--post-quantum-key-exchange=ENABLED` on the SSL policy attached to the
Google Cloud load balancers fronting `api.sanity.io`, `apicdn.sanity.io` and
`cdn.sanity.io`.

That single setting change makes the Content Lake reachable from Cloudflare
Workers running on a custom domain. Today it is not.

## What breaks



This blocks the standard Sanity-on-Cloudflare setup: server-rendered draft
previews, on-demand rendering, and any same-origin image proxy in front of
`cdn.sanity.io`.

Project `85i3osnk`, dataset `production`. Both `api.sanity.io` and the
project-scoped `85i3osnk.api.sanity.io` / `85i3osnk.apicdn.sanity.io` hostnames
fail identically.

## Cause



Measured from our machine (`openssl s_client -groups X25519MLKEM768`):

| endpoint | fronted by | `X25519MLKEM768` |
| --- | --- | --- |
| `api.sanity.io` (34.111.181.219) | Google Cloud LB | **no** — `handshake_failure` (alert 40) |
| `apicdn.sanity.io` (34.49.206.188) | Google Cloud LB | **no** — `handshake_failure` (alert 40) |
| `cdn.sanity.io` (34.149.250.58) | Google Cloud LB | **no** — `handshake_failure` (alert 40) |
| `www.sanity.io` (Vercel) | Vercel | yes |

The correlation is exact: across 11 third-party origins we probed from the same
Worker, the ones that 525 are the ones that reject `X25519MLKEM768`, and the
ones that succeed accept it. `www.sanity.io` — your marketing site, on Vercel —
supports it and works fine from the same Worker. The API endpoints on Google
Cloud do not, and don't.

To be clear: **your endpoints are not misbehaving.** Rejecting an unsupported
group is spec-correct, and given a ClientHello offering `X25519MLKEM768` *plus*
a classical group they fall back correctly via HelloRetryRequest. The underlying
defect is on Cloudflare's side. We cannot file it with them — this is a free
plan with no support channel — and enabling the group on your side sidesteps it
completely.

## Why this is a small change

Google Cloud Load Balancing supports `X25519MLKEM768` today, gated behind one
SSL-policy setting
([docs](https://docs.cloud.google.com/load-balancing/docs/post-quantum-tls)):

```
gcloud compute ssl-policies update SSL_POLICY_NAME \
    --post-quantum-key-exchange ENABLED
```

Per Google's published timeline, the setting currently defaults to disabled, but
**Google enables post-quantum key exchange by default in October 2026** — so
this is a matter of turning on a few weeks early something that is arriving
regardless. Clients that don't advertise the group are unaffected; it is
purely additive.

## Competitive context

Every other headless CMS API we probed already negotiates `X25519MLKEM768`, and
therefore already works from Cloudflare Workers on a custom domain:

| API | `X25519MLKEM768` |
| --- | --- |
| `api.contentful.com`, `cdn.contentful.com` | yes |
| `api.storyblok.com` | yes |
| `cdn.builder.io` | yes |
| `graphql.datocms.com` | yes |
| `api.hygraph.com` | yes |
| **`api.sanity.io`, `cdn.sanity.io`** | **no** |

Since Cloudflare is rolling this out across customer zones, we expect more
Sanity customers on Cloudflare Workers to hit this, with a symptom (525) that
gives no hint of the cause.

## Reproduction

Any Cloudflare Worker deployed to a Custom Domain, with no dependencies:

```js
export default {
  async fetch() {
    const r = await fetch("https://api.sanity.io/v1/ping");
    return new Response(`status ${r.status}`);
  },
};
```

- Deployed to `*.workers.dev` → **200**
- The same script deployed to a Custom Domain on a zone → **525**

Confirming the TLS property directly, independent of Cloudflare:

```sh
openssl s_client -connect api.sanity.io:443 -servername api.sanity.io \
  -groups X25519MLKEM768 -tls1_3
#  -> ssl/tls alert handshake failure ... SSL alert number 40

openssl s_client -connect www.sanity.io:443 -servername www.sanity.io \
  -groups X25519MLKEM768 -tls1_3
#  -> Negotiated TLS1.3 group: X25519MLKEM768
```

## Current workaround

The only option we have found is to move the preview Worker to `*.workers.dev`,
where outbound TLS is unaffected. That would restore previews but costs us the
custom hostname, and it does not help the image proxy, which has to run on our
own domain to be same-origin. We would rather not restructure our deployment
around this.

Full technical evidence, including the isolation showing the failure is inside
Cloudflare's `fetch()` path rather than in your infrastructure, is in
`CF-525-EVIDENCE.md`.
