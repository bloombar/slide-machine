/**
 * Unit tests for per-phrase candidate gathering: each keyword phrase is
 * queried separately (never concatenated into one over-specified query),
 * the results are pooled and de-duplicated by URL, and the phrase count is
 * capped. Flickr needs no key here — it stays dormant without one.
 *
 * Also covers `imageLookups` metering (BILL-3), which happens here because
 * this is the one place both automatic enrichment and the manual picker fan
 * out from.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const meterUsage = vi.fn()
vi.mock('../billing/usage-context', () => ({ meterUsage }))

const { gatherCandidates } = await import('./gather')

/**
 * Stubs the sources: Wikimedia returns the SAME image for every query (to
 * exercise de-duplication); Openverse returns a distinct image per query
 * (to prove per-phrase pooling). Records each query term seen.
 */
const stub = () => {
  const wikiQueries: string[] = []
  const ovQueries: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.hostname.includes('wikimedia')) {
        wikiQueries.push(url.searchParams.get('gsrsearch') ?? '')
        return {
          ok: true,
          status: 200,
          json: async () => ({
            query: {
              pages: {
                '1': {
                  title: 'File:Shared.png',
                  imageinfo: [
                    { thumburl: 'http://wiki/shared.png', thumbwidth: 800 },
                  ],
                },
              },
            },
          }),
        } as Response
      }
      if (url.hostname.includes('openverse')) {
        const q = url.searchParams.get('q') ?? ''
        ovQueries.push(q)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              { thumbnail: `http://ov/${q}.jpg`, title: q, width: 900 },
            ],
          }),
        } as Response
      }
      // Flickr (or anything else) — empty
      return { ok: true, status: 200, json: async () => ({}) } as Response
    }),
  )
  return { wikiQueries, ovQueries }
}

beforeEach(() => meterUsage.mockClear())
afterEach(() => vi.unstubAllGlobals())

describe('gatherCandidates', () => {
  it('queries each phrase separately, never a concatenation', async () => {
    const { wikiQueries, ovQueries } = stub()
    await gatherCandidates(['hobby horse', 'toy horse on stick'], 1000)
    // Two phrases → two per-source queries, each the phrase VERBATIM
    expect(wikiQueries.sort()).toEqual(['hobby horse', 'toy horse on stick'])
    expect(ovQueries.sort()).toEqual(['hobby horse', 'toy horse on stick'])
    // The over-specified join is never sent
    expect(wikiQueries).not.toContain('hobby horse toy horse on stick')
  })

  it('pools results across phrases and de-duplicates by URL', async () => {
    stub()
    const pool = await gatherCandidates(['alpha', 'beta'], 1000)
    const urls = pool.map(c => c.url)
    // Openverse contributes one distinct image per phrase
    expect(urls).toContain('http://ov/alpha.jpg')
    expect(urls).toContain('http://ov/beta.jpg')
    // Wikimedia returned the same image for both phrases → kept once
    expect(urls.filter(u => u === 'http://wiki/shared.png')).toHaveLength(1)
  })

  it('caps the number of phrases it fans out on', async () => {
    const { ovQueries } = stub()
    await gatherCandidates(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 1000)
    // Only the first six phrases are searched; the tail is trimmed
    expect(ovQueries.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('returns nothing when given no usable phrases', async () => {
    const { ovQueries } = stub()
    expect(await gatherCandidates(['', '  '], 1000)).toEqual([])
    expect(ovQueries).toHaveLength(0)
  })

  describe('imageLookups metering (BILL-3)', () => {
    it('spends one lookup per call, however wide the fan-out', async () => {
      const { ovQueries } = stub()
      await gatherCandidates(['alpha', 'beta', 'gamma'], 1000)
      // Three phrases across three sources is nine outbound requests, and the
      // user is charged for one lookup — the metric is slide images resolved,
      // not HTTP calls, so retuning the fan-out must not move it.
      expect(ovQueries).toHaveLength(3)
      expect(meterUsage).toHaveBeenCalledTimes(1)
      expect(meterUsage).toHaveBeenCalledWith('imageLookups', 1)
    })

    it('spends the lookup even when no source has a match', async () => {
      // The searches are what cost; finding nothing does not refund them.
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            ({ ok: true, status: 200, json: async () => ({}) }) as Response,
        ),
      )
      expect(await gatherCandidates(['nothing matches this'], 1000)).toEqual([])
      expect(meterUsage).toHaveBeenCalledWith('imageLookups', 1)
    })

    it('spends nothing when there was no usable phrase to search', async () => {
      stub()
      await gatherCandidates(['', '  '], 1000)
      expect(meterUsage).not.toHaveBeenCalled()
    })
  })
})
