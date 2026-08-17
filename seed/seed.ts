import {createReadStream} from 'node:fs'
import {createClient} from '@sanity/client'

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: process.env.SANITY_DATASET!,
  apiVersion: '2026-08-15',
  useCdn: false,
  // Same env var migrate.ts reads — this package had drifted between the two
  // names; SANITY_API_TOKEN is the one actually set in .env.local.
  token: process.env.SANITY_API_TOKEN,
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

// suffix lets the email sit mid-sentence (e.g. "...an hi@softmess.de,
// verwenden wir...") rather than only as a trailing "label: address" line.
const emailBlock = (prefix: string, suffix: string, key: string) => ({
  _key: key,
  _type: 'block',
  style: 'normal',
  markDefs: [{_key: `${key}m`, _type: 'link', href: 'mailto:hi@softmess.de'}],
  children: [
    {_key: `${key}a`, _type: 'span', text: prefix, marks: []},
    {_key: `${key}b`, _type: 'span', text: 'hi@softmess.de', marks: [`${key}m`]},
    ...(suffix ? [{_key: `${key}c`, _type: 'span', text: suffix, marks: []}] : []),
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

// page documents get generated _ids, so identity is tracked by slug instead.
// Default mode skips a slug that already exists; SEED_REPLACE=1 overwrites it
// in place, reusing the existing _id so any reference (e.g. footerLinks)
// survives. Returns the _id either way, so callers can wire up navigation.
async function upsertPage(doc: {title: string; slug: string; content: unknown[]}) {
  const existingId = (await client.fetch(
    `*[_type == "page" && slug.current == $slug][0]._id`,
    {slug: doc.slug},
  )) as string | null

  const pageDoc = {
    _type: 'page',
    title: doc.title,
    slug: {_type: 'slug', current: doc.slug},
    pageBuilder: [{_key: 'rt1', _type: 'richText', width: 'schmal', content: doc.content}],
  }

  if (REPLACE) {
    if (existingId) {
      await client.createOrReplace({...pageDoc, _id: existingId})
      console.log(`replaced page/${doc.slug} (${existingId})`)
      return existingId
    }
    const created = await client.create(pageDoc)
    console.log(`created page/${doc.slug} (${created._id})`)
    return created._id
  }

  if (existingId) {
    console.log(`skipped page/${doc.slug} — already exists (${existingId})`)
    return existingId
  }

  const created = await client.create(pageDoc)
  console.log(`created page/${doc.slug} (${created._id})`)
  return created._id
}

async function main() {
  const redId = await uploadCharm('images/charm-red.jpg', 'charm-red')
  await uploadCharm('images/charm-green.jpg', 'charm-green')

  // Pages are created before siteSettings so their _ids exist for footerLinks.
  const impressumId = await upsertPage({
    title: 'Impressum',
    slug: 'impressum',
    content: [
      block('Angaben gemäß § 5 DDG', 'normal', 'k1'),
      block('Verantwortlich für diese Website', 'h2', 'a1'),
      block(`Dorina Mazetti, softmess project, ${STREET}, ${CITY}, Germany`, 'normal', 'a2'),
      block('Kontakt', 'h2', 'b1'),
      emailBlock('E-Mail: ', '', 'b2'),
      block('Verantwortlich für den redaktionellen Inhalt', 'h2', 'c1'),
      block('Dorina Mazetti (Anschrift wie oben), § 18 (2) MStV.', 'normal', 'c2'),
      block('Umsatzsteuer', 'h2', 'd1'),
      block(
        'Kleinunternehmer gemäß § 19 UStG: Es wird keine Umsatzsteuer berechnet und keine Umsatzsteuer-Identifikationsnummer ausgewiesen.',
        'normal',
        'd2',
      ),
      block('Streitschlichtung', 'h2', 'e1'),
      block(
        'Wir sind nicht verpflichtet und nicht bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.',
        'normal',
        'e2',
      ),
      block('Haftung für Inhalte', 'h2', 'f1'),
      block(
        'Die Inhalte dieser Seite wurden mit Sorgfalt erstellt; für ihre Richtigkeit, Vollständigkeit und Aktualität wird jedoch keine Gewähr übernommen.',
        'normal',
        'f2',
      ),
      block(
        'Diese Website verlinkt auf externe Websites, auf deren Inhalte wir keinen Einfluss haben. Für die Inhalte verlinkter Seiten ist der jeweilige Anbieter verantwortlich; zum Zeitpunkt der Verlinkung waren keine rechtswidrigen Inhalte erkennbar.',
        'normal',
        'f3',
      ),
      block('Urheberrecht', 'h2', 'g1'),
      block(
        'Alle Fotos und Texte auf dieser Website stammen von Dorina Mazetti. Bitte vor einer Weiterverwendung nachfragen.',
        'normal',
        'g2',
      ),
    ],
  })

  const datenschutzId = await upsertPage({
    title: 'Datenschutz',
    slug: 'datenschutz',
    content: [
      block('Datenschutzerklärung · DSGVO', 'normal', 'k1'),
      block(
        'Dies ist eine kleine, schlichte Website. Es gibt keine Konten, keinen Shop, keine Cookies, keine Analyse- und keine Werbetools. Verarbeitet wird nur, was dein Browser ohnehin senden muss, um die Seite zu laden.',
        'normal',
        'p0',
      ),
      block('Verantwortlicher', 'h2', 'p1'),
      block(`Dorina Mazetti, ${STREET}, ${CITY}, Germany`, 'normal', 'p2'),
      block('Hosting und Server-Logs', 'h2', 'p3'),
      block(
        'Diese Website wird bei Cloudflare Workers gehostet (Cloudflare, Inc. / Cloudflare Germany GmbH). Beim Aufruf einer Seite verarbeitet der Hoster deine IP-Adresse, den Zeitpunkt der Anfrage, die aufgerufene Seite, den Referrer sowie Angaben zu Browser und Betriebssystem. Das ist technisch notwendig, um die Seite auszuliefern und abzusichern; Rechtsgrundlage ist unser berechtigtes Interesse, Art. 6 Abs. 1 lit. f DSGVO. Die Logs werden nur kurz gespeichert und nicht mit anderen Daten zusammengeführt. Cloudflare betreibt ein weltweites Netzwerk, daher kann es zu Übermittlungen in Drittländer auf Grundlage der EU-Standardvertragsklauseln kommen; ein Auftragsverarbeitungsvertrag nach Art. 28 DSGVO liegt vor.',
        'normal',
        'p4',
      ),
      block('Cookies, Analyse, Schriften und Bilder', 'h2', 'p5'),
      block(
        'Es werden keine Cookies gesetzt und keine Analyse- oder Tracking-Tools eingesetzt. Schriftarten sind selbst gehostet und werden direkt von dieser Website ausgeliefert. Bilder werden dagegen über das CDN von Sanity eingebunden (Sanity.io, Sanity AS, Oslo, Norwegen); beim Laden eines Bildes wird deine IP-Adresse an Sanity übertragen.',
        'normal',
        'p6',
      ),
      block('Instagram', 'h2', 'p7'),
      block(
        'Der Instagram-Button ist ein einfacher Link. Solange du dich auf dieser Website befindest, wird nichts von Meta geladen, und es werden keine Daten an Meta gesendet — es sei denn, du klickst den Link an. Folgst du ihm, verarbeitet Meta Platforms Ireland Ltd. deine Daten nach eigener Datenschutzerklärung, auf die wir keinen Einfluss haben.',
        'normal',
        'p8',
      ),
      block('Kontakt per E-Mail', 'h2', 'p9'),
      block(
        'Schreibst du uns eine E-Mail an hi@softmess.de, verwenden wir deine Nachricht und deine Absenderadresse ausschließlich, um deine Anfrage zu beantworten, und geben sie nicht an Dritte weiter.',
        'normal',
        'p10',
      ),
      block('Deine Rechte', 'h2', 'p11'),
      block(
        'Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch (Art. 15–21 DSGVO). Beruht eine Verarbeitung auf einer Einwilligung, kannst du diese jederzeit widerrufen.',
        'normal',
        'p12',
      ),
      block(
        'Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren — in der Regel die Behörde des Bundeslands, in dem der Verantwortliche seinen Sitz hat.',
        'normal',
        'p13',
      ),
      block('Verschlüsselung', 'h2', 'p14'),
      block(
        'Diese Website wird über TLS (https) ausgeliefert, die Verbindung zwischen deinem Browser und dem Server ist also verschlüsselt.',
        'normal',
        'p15',
      ),
    ],
  })

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
    backLabel: '← zurück',
    instagramLabel: 'instagram',
    notFound: {heading: 'verirrt', body: "diese seite gibt's hier nicht."},
    seo: {
      title: 'softmess project',
      description:
        'handgemachte anhänger aus paracord und resin clay, gepresst in formen, die einfach nicht stillhalten wollen.',
    },
    footerLinks: [
      {_key: 'impressum', _type: 'navLink', page: {_type: 'reference', _ref: impressumId}},
      {_key: 'datenschutz', _type: 'navLink', page: {_type: 'reference', _ref: datenschutzId}},
    ],
  })

  await upsertSingleton({
    _id: 'homePage',
    _type: 'homePage',
    heading: 'softmess',
    statement: 'folg dem weißen kaninchen.',
    body: [
      "dinge, die ich gemacht habe, weil ich wissen wollte, ob ich's kann — anhänger aus paracord und resin clay, gepresst in formen, die einfach nicht stillhalten wollen.",
      'ganz klar handgemacht & wahrscheinlich nur einmal gemacht. zuhause in 353.',
    ],
    charm: {
      _type: 'image',
      alt: 'Ein handgemachter Anhänger aus Resin Clay an einer Paracord-Kordel',
      asset: {_type: 'reference', _ref: redId},
    },
    actions: [
      {
        _key: 'instagram',
        _type: 'action',
        label: 'alles passiert auf instagram',
        href: 'https://www.instagram.com/softmess.project/',
      },
      {_key: 'email', _type: 'action', label: 'hi@softmess.de', href: 'mailto:hi@softmess.de'},
    ],
  })

  console.log('seeded')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
