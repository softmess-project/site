import type {APIRoute} from 'astro'
import {iconResponse} from '../lib/icon'

// 180×180 is the size iOS asks for, and it doubles as Organization.logo in the
// JSON-LD — comfortably past Google's 112×112 minimum for a logo, and on our
// own origin, so the structured data names no third-party host.
export const GET: APIRoute = ({locals}) => iconResponse(locals.sanity, 180)
