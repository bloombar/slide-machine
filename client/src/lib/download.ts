/**
 * Triggers a browser download of a base64-encoded file returned by an export
 * action (deck/template YAML, PDF). Decodes to a Blob and clicks a temporary
 * link, so binary payloads survive intact.
 */
import type { ExportDownload } from '@slide-machine/shared'

/** Decodes base64 contents into a Blob of the given MIME type. */
const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

/** Saves the exported file to disk under its suggested name. */
export const downloadExport = (file: ExportDownload): void => {
  const url = URL.createObjectURL(
    base64ToBlob(file.contentBase64, file.mimeType),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = file.fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Defer the revoke: some browsers read the blob asynchronously after the
  // click, and revoking on the same tick can produce an empty download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
