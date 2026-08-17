import {describe, expect, it} from 'vitest'
import {upstreamFor} from '../src/worker'

const env = {
  ASSETS: {fetch: async () => new Response(null)},
  SANITY_PROJECT_ID: '85i3osnk',
  SANITY_DATASET: 'production',
}

const ASSET = 'a4762a66ff4e0a56d80ae17a10742c2c7a67940f-966x1207.jpg'

describe('the /cdn image proxy', () => {
  it('maps an image path to its Sanity URL', () => {
    expect(upstreamFor(`/cdn/images/85i3osnk/production/${ASSET}`, env)).toBe(
      `https://cdn.sanity.io/images/85i3osnk/production/${ASSET}`,
    )
  })

  it('maps a file path too', () => {
    expect(upstreamFor('/cdn/files/85i3osnk/production/abc123.pdf', env)).toBe(
      'https://cdn.sanity.io/files/85i3osnk/production/abc123.pdf',
    )
  })

  it('ignores paths it does not own, so the asset router keeps serving them', () => {
    expect(upstreamFor('/', env)).toBeNull()
    expect(upstreamFor('/impressum', env)).toBeNull()
    expect(upstreamFor('/_astro/Base.BLUQ19LV.css', env)).toBeNull()
  })

  // The reason the route is pinned rather than a generic pass-through: without
  // these checks, /cdn/* would be an open proxy anyone could point at any
  // Sanity project — or, with a traversal, at another host entirely.
  describe('refuses to act as an open proxy', () => {
    it('rejects another project or dataset', () => {
      expect(upstreamFor(`/cdn/images/someoneelse/production/${ASSET}`, env)).toBeNull()
      expect(upstreamFor(`/cdn/images/85i3osnk/staging/${ASSET}`, env)).toBeNull()
    })

    it('rejects a kind that is not images or files', () => {
      expect(upstreamFor('/cdn/data/85i3osnk/production/query', env)).toBeNull()
      expect(upstreamFor(`/cdn/85i3osnk/production/${ASSET}`, env)).toBeNull()
    })

    it('rejects anything but a single asset segment', () => {
      expect(upstreamFor('/cdn/images/85i3osnk/production/', env)).toBeNull()
      expect(upstreamFor('/cdn/images/85i3osnk/production', env)).toBeNull()
      expect(upstreamFor(`/cdn/images/85i3osnk/production/deeper/${ASSET}`, env)).toBeNull()
    })

    it('cannot be walked out of with a traversal segment', () => {
      // new URL() would resolve `..` against the CDN origin, so the guard has
      // to reject the extra segments before a URL is ever constructed.
      expect(upstreamFor('/cdn/images/85i3osnk/production/../../../etc/passwd', env)).toBeNull()
      expect(upstreamFor('/cdn/../data/query/production', env)).toBeNull()
    })
  })
})
