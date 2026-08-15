import {createReadStream} from 'node:fs'
import {createClient} from '@sanity/client'

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET!,
  apiVersion: '2026-08-15',
  useCdn: false,
  token: process.env.SANITY_WRITE_TOKEN,
})

// Default is safe: fill an empty dataset without touching existing content.
// SEED_REPLACE=1 makes the script authoritative and overwrites what is there —
// only ever run that deliberately, against content you are willing to lose.
const REPLACE = process.env.SEED_REPLACE === '1'

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

// Singletons (siteSettings, homePage) have fixed _ids. Default mode leaves an
// existing document untouched; SEED_REPLACE=1 makes this script authoritative
// and overwrites whatever is there, reusing the same _id.
async function upsertSingleton(doc: Record<string, unknown> & {_id: string}) {
  const existing = await client.getDocument(doc._id)
  if (REPLACE) {
    await client.createOrReplace(doc)
    console.log(`${existing ? 'replaced' : 'created'} ${doc._id}`)
    return
  }
  if (existing) {
    console.log(`skipped ${doc._id} — already exists`)
    return
  }
  await client.createIfNotExists(doc)
  console.log(`created ${doc._id}`)
}

// legalPage documents get generated _ids, so identity is tracked by slug
// instead. Default mode skips a slug that already exists; SEED_REPLACE=1
// overwrites it in place, reusing the existing _id so any reference survives.
async function upsertLegalPage(doc: Record<string, unknown> & {slug: {current: string}}) {
  const slug = doc.slug.current
  const existingId = (await client.fetch(
    `*[_type == "legalPage" && slug.current == $slug][0]._id`,
    {slug},
  )) as string | null

  if (REPLACE) {
    if (existingId) {
      await client.createOrReplace({...doc, _id: existingId})
      console.log(`replaced legalPage/${slug} (${existingId})`)
    } else {
      const created = await client.create(doc)
      console.log(`created legalPage/${slug} (${created._id})`)
    }
    return
  }

  if (existingId) {
    console.log(`skipped legalPage/${slug} — already exists (${existingId})`)
    return
  }

  const created = await client.create(doc)
  console.log(`created legalPage/${slug} (${created._id})`)
}

async function main() {
  const redId = await uploadCharm('images/charm-red.jpg', 'charm-red')
  await uploadCharm('images/charm-green.jpg', 'charm-green')

  await upsertSingleton({
    _id: 'siteSettings',
    _type: 'siteSettings',
    brand: 'softmess',
    tagline: 'project',
    email: 'hi@softmess.de',
    instagram: 'https://www.instagram.com/softmess.project/',
    instagramHandle: '@softmess.project',
    copyright: '© 2026 softmess project',
    // Added by Task 12 — these were hardcoded in the templates until then.
    backLabel: '← back',
    instagramLabel: 'instagram',
    notFound: {heading: 'lost', body: "that page isn't here."},
    seo: {
      title: 'softmess project',
      description:
        'handmade charms of paracord and resin clay, squeezed into shapes that refuse to sit still.',
    },
  })

  await upsertSingleton({
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

  await upsertLegalPage({
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

  await upsertLegalPage({
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
