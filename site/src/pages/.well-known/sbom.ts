import type {APIRoute} from 'astro'
import bagelFatOne from '@fontsource/bagel-fat-one/package.json'
import outfit from '@fontsource/outfit/package.json'
import astro from 'astro/package.json'
import sanityClient from '@sanity/client/package.json'
import sanityImageUrl from '@sanity/image-url/package.json'
import tailwindcss from 'tailwindcss/package.json'

// A CycloneDX bill of materials at /.well-known/sbom, the URI RFC 9472
// registers. That RFC is a MUD/IoT device-transparency spec and defines no SBOM
// format at all, only how to locate one; the format is declared by the
// Content-Type, which public/_headers has to set — the headers on the Response
// below exist for `astro dev` and are discarded by the static build, where
// Cloudflare's asset router types the file and the path has no extension to
// type it by.
//
// A prerendered endpoint rather than an astro:build:done hook or a file in
// public/, for the reason robots.txt.ts already gives: it lands in dist/ like a
// static asset and the origin follows whichever build made it. `.well-known` is
// the one dot-directory Astro's route crawler does not skip.
//
// Both lists below are written out by hand, and that is the point of the
// document. The published site ships no JavaScript and no third-party
// subresource, so almost nothing in the ~500-package pnpm graph reaches a
// visitor: what does is the self-hosted font files, and everything else only
// ran at build time. CycloneDX already draws that line — `components` is what
// the artifact contains, `metadata.tools` is what produced it — so the honest
// document is a short one, and a generator pointed at the lockfile would
// produce a longer and less true one.
type Manifest = {name: string; version: string; license: string; homepage?: string}

// Anything that starts shipping bytes to the browser belongs here. dist.test.ts
// pins this against Base.astro's own imports, in both directions: adding a font
// there without adding it here fails, and so does listing one that is no longer
// imported.
const SHIPPED: Manifest[] = [bagelFatOne, outfit]

// What turns content into the delivered bytes. Not @astrojs/cloudflare: the
// static build sets `adapter: undefined` (astro.config.mjs), so the adapter
// never runs for the artifact this document describes.
const TOOLS: Manifest[] = [astro, tailwindcss, sanityClient, sanityImageUrl]

function component(pkg: Manifest, type: 'library' | 'application') {
  return {
    type,
    name: pkg.name,
    version: pkg.version,
    // The npm purl type percent-encodes the scope's `@`, which appears only as
    // the first character of a scoped name.
    purl: `pkg:npm/${pkg.name.replace('@', '%40')}@${pkg.version}`,
    // Every package listed above carries a plain SPDX identifier (MIT,
    // OFL-1.1); one whose `license` is an expression would need CycloneDX's
    // `expression` form instead, so check before adding it.
    licenses: [{license: {id: pkg.license}}],
    ...(pkg.homepage ? {externalReferences: [{type: 'website', url: pkg.homepage}]} : {}),
  }
}

export const GET: APIRoute = ({site}) => {
  // The preview Worker is editor-only and is not the artifact this describes,
  // so the route 404s there exactly as sitemap.xml.ts does.
  if (import.meta.env.PREVIEW) {
    return new Response(null, {status: 404})
  }

  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        // Not 'web-app', however much CycloneDX sounds like it should have one:
        // the classification enum has no such member and a strict validator
        // rejects it.
        type: 'application',
        name: new URL('/', site).hostname,
        description: 'The softmess.de website as served: static HTML, CSS and self-hosted fonts.',
      },
      tools: {components: TOOLS.map((pkg) => component(pkg, 'application'))},
    },
    components: SHIPPED.map((pkg) => component(pkg, 'library')),
  }

  return new Response(JSON.stringify(bom, null, 2) + '\n', {
    headers: {'content-type': 'application/vnd.cyclonedx+json; version=1.6'},
  })
}
