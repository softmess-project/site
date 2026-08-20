import type {APIRoute} from 'astro'
import {iconResponse} from '../lib/icon'

// 96×96: Google wants a favicon whose dimensions are a multiple of 48px
// square. Deliberately a prerendered endpoint rather than a file in public/ —
// the art is editor-managed in Sanity, and this is the same shape robots.txt.ts
// and sitemap.xml.ts already use to turn Sanity content into a static file.
export const GET: APIRoute = ({locals}) => iconResponse(locals.sanity, 96)
