import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, rmSync} from 'node:fs'

const FILE = 'site/src/sanity.types.ts'
const STABLE_MS = 300
const TIMEOUT_MS = 60_000
const POLL_MS = 100

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const hash = () => createHash('sha1').update(readFileSync(FILE)).digest('hex')

// `sanity typegen generate` writes its output AFTER the CLI process exits, so
// waiting for the file to "stop changing" can finish while it still holds the
// old content — which is indistinguishable from no drift. Deleting it first
// removes the ambiguity: the file cannot be stale if it does not exist, so its
// reappearance is the write, and only then is a comparison meaningful.
rmSync(FILE, {force: true})

try {
  execFileSync('pnpm', ['typegen'], {stdio: 'inherit'})

  const started = Date.now()
  let previous = null
  let stableFor = 0

  while (stableFor < STABLE_MS) {
    if (Date.now() - started > TIMEOUT_MS) {
      throw new Error(`${FILE} was never regenerated within ${TIMEOUT_MS}ms`)
    }
    await sleep(POLL_MS)
    if (!existsSync(FILE)) continue
    const current = hash()
    stableFor = current === previous ? stableFor + POLL_MS : 0
    previous = current
  }
} catch (error) {
  // Never leave the working tree missing a generated file we deleted.
  execFileSync('git', ['checkout', '--', FILE], {stdio: 'ignore'})
  throw error
}

execFileSync('git', ['diff', '--exit-code', '--', FILE], {stdio: 'inherit'})
