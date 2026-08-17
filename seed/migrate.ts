import {createClient} from '@sanity/client'

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET!,
  apiVersion: '2026-08-15',
  useCdn: false,
  // The token seed.ts also reads — the project's write token is scoped to
  // "Deploy Studio" (create + read, no update), so applying this migration's
  // homePage/siteSettings patches needs a session with more than that; see
  // the migration report for how this run was actually authorized.
  token: process.env.SANITY_API_TOKEN,
})

// Dry run by default. MIGRATE_APPLY=1 is the only thing that writes.
const APPLY = process.env.MIGRATE_APPLY === '1'

// Sanity requires a unique _key on every array member and does not add one for
// you on programmatic writes. A missing _key breaks drag-reorder and overlays.
const key = () => crypto.randomUUID().slice(0, 12)

const SLUGS: Record<string, string> = {imprint: 'impressum', privacy: 'datenschutz'}

async function main() {
  const mutations: Array<Record<string, unknown>> = []

  // 1. homePage's five fields collapse into one hero block.
  const home = await client.getDocument('homePage')
  if (!home) throw new Error('homePage not found — nothing to migrate')
  if (home.pageBuilder) {
    console.log('homePage already migrated, skipping')
  } else {
    mutations.push({
      patch: {
        id: 'homePage',
        set: {
          pageBuilder: [
            {
              _key: key(),
              _type: 'hero',
              heading: home.heading,
              statement: home.statement,
              body: home.body,
              image: home.charm,
              imagePosition: 'rechts',
              actions: home.actions,
            },
          ],
        },
        unset: ['heading', 'statement', 'body', 'charm', 'actions'],
      },
    })
  }

  // 2. Each legalPage becomes a page holding one richText block. The kicker has
  //    no home on any block, and dropping it silently would lose
  //    "Angaben gemäß § 5 DDG" — so it is prepended to the body as a paragraph.
  const legal = await client.fetch<any[]>('*[_type == "legalPage"]')

  // Seeds pageIds with any page that already exists for these slugs — both so
  // a re-run against a dataset with no legalPage docs left (the normal case,
  // once migrated) still knows the nav targets, and so a partial re-run that
  // still has legalPage docs doesn't create a second page with the same slug.
  const existingPages = await client.fetch<Array<{_id: string; slug: string}>>(
    '*[_type == "page" && slug.current in $slugs]{_id, "slug": slug.current}',
    {slugs: Object.values(SLUGS)},
  )
  const pageIds: Record<string, string> = Object.fromEntries(
    existingPages.map((p) => [p.slug, p._id]),
  )

  for (const doc of legal) {
    const oldSlug = doc.slug?.current as string
    const newSlug = SLUGS[oldSlug] ?? oldSlug
    if (pageIds[newSlug]) {
      console.log(`page "${newSlug}" already exists, skipping creation`)
      continue
    }
    const id = crypto.randomUUID()
    pageIds[newSlug] = id

    const kickerBlock = doc.kicker
      ? [
          {
            _key: key(),
            _type: 'block',
            style: 'normal',
            markDefs: [],
            children: [{_key: key(), _type: 'span', text: doc.kicker, marks: []}],
          },
        ]
      : []

    mutations.push({
      create: {
        _id: id,
        _type: 'page',
        title: doc.title,
        slug: {_type: 'slug', current: newSlug},
        pageBuilder: [
          {
            _key: key(),
            _type: 'richText',
            content: [...kickerBlock, ...(doc.body ?? [])],
            width: 'schmal',
          },
        ],
      },
    })
  }

  // 3. The nav LEGAL_PAGE_NAV_QUERY used to derive becomes explicit. This
  //    ESTABLISHES footerLinks once; it never re-establishes them. Two
  //    distinct ways a re-run could destroy live data, both guarded here:
  //      - empty pageIds (no pages found) would set footerLinks: [], wiping
  //        the footer nav entirely;
  //      - a non-empty rebuild would silently revert whatever the owner has
  //        since done in the Studio — reordered the links, renamed one, added
  //        a third — back to exactly [impressum, datenschutz].
  //    Neither is recoverable from the script's own output, so if footerLinks
  //    already holds anything, it is left strictly alone.
  const existingFooterLinks = await client.fetch<unknown[] | null>(
    '*[_id == "siteSettings"][0].footerLinks',
  )
  if (existingFooterLinks && existingFooterLinks.length > 0) {
    console.log(
      `siteSettings.footerLinks already has ${existingFooterLinks.length} entries — leaving it untouched`,
    )
  } else if (Object.keys(pageIds).length > 0) {
    mutations.push({
      patch: {
        id: 'siteSettings',
        set: {
          footerLinks: ['impressum', 'datenschutz']
            .filter((slug) => pageIds[slug])
            .map((slug) => ({
              _key: key(),
              _type: 'navLink',
              page: {_type: 'reference', _ref: pageIds[slug]},
            })),
        },
      },
    })
  } else {
    console.log('no page documents found — leaving footerLinks untouched')
  }

  console.log(JSON.stringify(mutations, null, 2))

  if (!APPLY) {
    console.log(`\nDry run — ${mutations.length} mutations, nothing written.`)
    console.log('Re-run with MIGRATE_APPLY=1 to apply.')
  } else {
    await client.transaction(mutations as any).commit()
    console.log(`\nApplied ${mutations.length} mutations.`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
