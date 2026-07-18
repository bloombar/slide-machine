/**
 * Unit tests for per-phrase candidate gathering: each keyword phrase is
 * queried separately (never concatenated into one over-specified query),
 * the results are pooled and de-duplicated by URL, and the phrase count is
 * capped. Flickr needs no key here — it stays dormant without one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { gatherCandidates } from './gather'

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
    await gatherCandidates(['a', 'b', 'c', 'd', 'e'], 1000)
    // Only the first three phrases are searched
    expect(ovQueries.sort()).toEqual(['a', 'b', 'c'])
  })

  it('returns nothing when given no usable phrases', async () => {
    const { ovQueries } = stub()
    expect(await gatherCandidates(['', '  '], 1000)).toEqual([])
    expect(ovQueries).toHaveLength(0)
  })
})
