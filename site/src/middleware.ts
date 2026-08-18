import type {MiddlewareHandler} from 'astro'
import {draftClient, publishedClient} from './lib/sanity'
import {isDraftMode} from './lib/draft'

export const onRequest: MiddlewareHandler = (context, next) => {
  const draft = isDraftMode(context.cookies, process.env.PREVIEW_DRAFT_SECRET)
  context.locals.draft = draft
  context.locals.sanity = draft ? draftClient() : publishedClient
  return next()
}
