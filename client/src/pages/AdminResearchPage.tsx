/**
 * The research export page (SPEC EVAL-2): downloads the de-identified
 * bundle — lectures, slides, transcripts, session telemetry, votes, and
 * cost events for a date range, keyed by opaque study ids. Static apart
 * from the two date fields; the download itself is a plain link, like the
 * CSV exports beside it.
 */
import { useState } from 'react'
import { downloadResearchBundle } from '../api/research'

/** An ISO instant covering the whole of a `<input type="date">` day; the
 * end date is inclusive, because "to the 15th" means through the 15th. */
const dayStart = (day: string): string =>
  new Date(`${day}T00:00:00.000Z`).toISOString()
const dayEnd = (day: string): string =>
  new Date(`${day}T23:59:59.999Z`).toISOString()

/** Fetches the bundle and hands it to the browser as a download. A plain
 * <a href> can't send the Bearer token, so the bytes arrive as a blob and
 * leave through a temporary object-URL anchor. */
const saveBundle = async (window: {
  from?: string
  to?: string
}): Promise<void> => {
  const blob = await downloadResearchBundle(window)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `research-export-${new Date().toISOString().slice(0, 10)}.zip`
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function AdminResearchPage() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [failed, setFailed] = useState(false)

  const download = async (): Promise<void> => {
    setDownloading(true)
    setFailed(false)
    try {
      await saveBundle({
        ...(from ? { from: dayStart(from) } : {}),
        ...(to ? { to: dayEnd(to) } : {}),
      })
    } catch {
      setFailed(true)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold">Research</h1>
      <p className="text-sm text-slate-600">
        The research export is one zip bundle for a date range: lectures and
        slides, transcript segments, session telemetry, quiz references, votes,
        and cost events. Accounts are identified only by an opaque study id —
        never by user id, email, or name — and the same account keeps the same
        id across exports, so bundles of different periods join.
      </p>
      <p className="mt-3 text-sm text-slate-600">
        Free text is <strong>not</strong> scrubbed: titles, slide bodies, and
        transcripts leave as spoken. The bundle&apos;s README repeats this —
        handle it under the study protocol, and never commit a bundle to a
        repository.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          From
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          To
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          onClick={download}
          disabled={downloading}
          className="rounded border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          {downloading ? 'Preparing…' : 'Download bundle (zip)'}
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Leave a date blank to leave that end of the range open.
      </p>
      {failed && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          Could not build the bundle.
        </p>
      )}
    </div>
  )
}
