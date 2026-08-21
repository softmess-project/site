import type {APIRoute} from 'astro'
import {getSiteSettings} from '../../lib/content'

// Every JRD this site is willing to answer for, built once at deploy time. The
// Worker in front of this path (src/worker.ts) picks one by `?resource=` and
// holds no identifier of its own, so a new subject — or the fediverse account,
// when there is one — is added here and nowhere else.
//
// It has to be built rather than fetched per request: a Worker on this zone
// cannot reach api.sanity.io at all (docs/BACKLOG.md §1.1). And it has to be a
// Worker rather than a plain file, because RFC 7033 is a query protocol and the
// asset router discards the query string — a static file would answer
// `?resource=acct:stranger@example.com` with a 200 claiming to be us, where the
// RFC demands a 404.

type Link = {rel: string; type?: string; href: string}

// `email` and `instagram` are required in the Studio, but TypeGen types every
// Sanity field as nullable, and a link with no address is worse than no link:
// it would ship `"href": null` to a third-party consumer. Dropping it instead
// keeps the document valid, and dist.test.ts fails the deploy build if the
// mailto ever goes missing, so the drop cannot pass unnoticed.
const links = (...items: (Link | null)[]) => items.filter((link): link is Link => link !== null)

export const GET: APIRoute = async ({locals, site}) => {
  // Editor-only and never public, so the route 404s there exactly as
  // sitemap.xml.ts and sbom.ts do.
  if (import.meta.env.PREVIEW) {
    return new Response(null, {status: 404})
  }

  const {email, instagram} = await getSiteSettings(locals.sanity)

  const home = new URL('/', site)
  const acct = (local: string) => `acct:${local}@${home.hostname}`

  const profilePage: Link = {
    rel: 'http://webfinger.net/rel/profile-page',
    type: 'text/html',
    href: home.href,
  }
  const contact = email ? {rel: 'me', href: `mailto:${email}`} : null

  const documents = [
    {
      subject: acct('softmess'),
      // The site is the project, so the two are one resource. Only this
      // document may claim it: two subjects claiming one alias would give a
      // query two right answers, and dist.test.ts rejects that.
      aliases: [home.href],
      links: links(
        profilePage,
        // Our own origin, not cdn.sanity.io — same reason the image proxy
        // exists. A static file in public/, so it is always there.
        {
          rel: 'http://webfinger.net/rel/avatar',
          type: 'image/png',
          href: new URL('/apple-touch-icon.png', site).href,
        },
        instagram ? {rel: 'me', href: instagram} : null,
        contact,
      ),
    },
    {
      subject: acct('moritz'),
      // No alias, no avatar, and none of the project's accounts. `rel="me"`
      // asserts that two URIs are the same entity, so carrying the project's
      // Instagram here would claim a person is an organisation. This document
      // is where a personal fediverse account goes when there is one.
      links: links(profilePage, contact),
    },
  ]

  // Not `application/jrd+json`: this body is a list of documents, not one, and
  // it is never served as-is. The Worker reads it through the ASSETS binding
  // and types the single document it returns. This header only matters to
  // `astro dev`, where no Worker runs.
  return new Response(JSON.stringify(documents, null, 2) + '\n', {
    headers: {'content-type': 'application/json; charset=utf-8'},
  })
}
