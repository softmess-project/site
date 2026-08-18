import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import type {APIContext, AstroCookies, MiddlewareNext} from 'astro'
import {onRequest} from '../src/middleware'
import {DRAFT_COOKIE} from '../src/lib/draft'
import {publishedClient} from '../src/lib/sanity'

// isDraftMode short-circuits to `false` whenever `import.meta.env.PREVIEW` is
// falsy, which is how vitest sees it by default (it's only inlined `true` by
// astro.config.mjs's `define`, under an actual PREVIEW=1 build). Without this,
// every case below -- cookie present or not -- would take the short-circuit
// and "pass" without ever running the cookie comparison, hiding exactly the
// kind of regression this test exists to catch. Flipping it here, at
// runtime, makes `import.meta.env.PREVIEW` a real mutable property under
// vitest (unlike under Astro's build, where it's statically inlined), so the
// middleware's actual branching runs for real.
;(import.meta.env as {PREVIEW?: boolean}).PREVIEW = true

const SECRET = 'test-secret-value'

// The secret reaches the middleware through process.env, which nodejs_compat
// populates from the Worker's bindings on the deployed preview.
beforeEach(() => {
  process.env.PREVIEW_DRAFT_SECRET = SECRET
})
afterEach(() => {
  delete process.env.PREVIEW_DRAFT_SECRET
})

function fakeContext(cookieValue?: string): APIContext {
  const cookies = {
    get: (name: string) =>
      name === DRAFT_COOKIE && cookieValue !== undefined ? {value: cookieValue} : undefined,
  } as unknown as AstroCookies
  return {cookies, locals: {}} as unknown as APIContext
}

// A `next` stub that records whether it ran and hands back an identifiable
// promise, so the test can confirm the middleware both calls it and returns
// its result unchanged, without pulling in a mocking framework.
function trackedNext() {
  let calls = 0
  const result = Promise.resolve(new Response('next-sentinel'))
  const next = (() => {
    calls += 1
    return result
  }) as unknown as MiddlewareNext
  return {next, result, callCount: () => calls}
}

describe('draft-mode middleware', () => {
  it('grants a drafts+stega client and marks draft mode when the cookie matches the secret', () => {
    const context = fakeContext(SECRET)
    const {next, result, callCount} = trackedNext()

    const returned = onRequest(context, next)

    expect(context.locals.draft).toBe(true)
    expect(context.locals.sanity).not.toBe(publishedClient)
    expect(context.locals.sanity.config().perspective).toBe('drafts')
    expect(context.locals.sanity.config().stega?.enabled).toBe(true)
    expect(callCount()).toBe(1)
    expect(returned).toBe(result)
  })

  it('falls back to the published client, by identity, without the cookie', () => {
    const context = fakeContext(undefined)
    const {next, result, callCount} = trackedNext()

    const returned = onRequest(context, next)

    expect(context.locals.draft).toBe(false)
    expect(context.locals.sanity).toBe(publishedClient)
    expect(callCount()).toBe(1)
    expect(returned).toBe(result)
  })

  it('treats a wrong cookie value as absent', () => {
    const context = fakeContext('nope')
    const {next, result, callCount} = trackedNext()

    const returned = onRequest(context, next)

    expect(context.locals.draft).toBe(false)
    expect(context.locals.sanity).toBe(publishedClient)
    expect(callCount()).toBe(1)
    expect(returned).toBe(result)
  })

  // The value the cookie used to carry before it was secret-backed. Anyone can
  // set it by hand, which is exactly what the perimeter used to cover for, so
  // this is the regression that matters most now that the host is public.
  it('treats the old bare `1` cookie as absent', () => {
    const context = fakeContext('1')
    const {next} = trackedNext()

    onRequest(context, next)

    expect(context.locals.draft).toBe(false)
    expect(context.locals.sanity).toBe(publishedClient)
  })

  // Fail closed: an unconfigured secret must never mean "everything is a draft".
  it('refuses draft mode when no secret is configured', () => {
    delete process.env.PREVIEW_DRAFT_SECRET
    const context = fakeContext('1')
    const {next} = trackedNext()

    onRequest(context, next)

    expect(context.locals.draft).toBe(false)
    expect(context.locals.sanity).toBe(publishedClient)
  })

  // An empty binding is the shape a missing `wrangler secret put` actually
  // takes, and it must not match an empty cookie.
  it('refuses draft mode when the secret is empty', () => {
    process.env.PREVIEW_DRAFT_SECRET = ''
    const context = fakeContext('')
    const {next} = trackedNext()

    onRequest(context, next)

    expect(context.locals.draft).toBe(false)
    expect(context.locals.sanity).toBe(publishedClient)
  })
})
