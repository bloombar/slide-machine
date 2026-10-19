/**
 * The "Export CSV" control on the admin cost and telemetry pages (SPEC
 * BILL-7, EVAL-1). Fetches the file with the admin's token and saves it;
 * a plain link can't send the Bearer header, so it would 401.
 */
import { useState } from 'react'
import { saveBlob } from '../../lib/download'

interface Props {
  /** Fetches the CSV for the period currently on screen. */
  download: () => Promise<Blob>
  /** Name the saved file gets; called at click time so the date is current. */
  fileName: () => string
  /** True until the period being exported is known, so the file can never
   * cover a different period than the one selected. */
  disabled?: boolean
}

export default function ExportCsvButton({
  download,
  fileName,
  disabled = false,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try {
      saveBlob(await download(), fileName())
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={busy || disabled}
        aria-busy={busy}
        className="rounded border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
      >
        {busy ? 'Exporting…' : 'Export CSV'}
      </button>
      {failed && (
        <p role="alert" className="text-sm text-red-600">
          Could not export the CSV.
        </p>
      )}
    </>
  )
}
