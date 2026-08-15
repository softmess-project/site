// `sanity typegen generate` writes its output ~0.3s AFTER the CLI exits, so a
// plain `pnpm typegen && git diff --exit-code` races the write and passes no
// matter what. Wait for the file to settle, then compare.
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'

const FILE = 'site/src/sanity.types.ts'
const STABLE_MS = 750
const TIMEOUT_MS = 30_000
const hash = () => createHash('sha1').update(readFileSync(FILE)).digest('hex')

let previous = hash()
let stableFor = 0
const started = Date.now()

while (stableFor < STABLE_MS) {
  if (Date.now() - started > TIMEOUT_MS) {
    console.error(`${FILE} never stopped changing within ${TIMEOUT_MS}ms`)
    process.exit(1)
  }
  await new Promise((resolve) => setTimeout(resolve, 150))
  const current = hash()
  stableFor = current === previous ? stableFor + 150 : 0
  previous = current
}

execFileSync('git', ['diff', '--exit-code', '--', FILE], {stdio: 'inherit'})
