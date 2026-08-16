/**
 * Reading a picked file for an import (EXP-3/EXP-5).
 *
 * Two kinds arrive through the same button, because to the instructor they
 * are the same errand — "bring this in" — and asking them to sort their own
 * files into the right box first is work the app can do itself.
 *
 * A `.yaml` this app wrote is text and travels as text. A `.pptx` is a zip,
 * so it travels as base64: `file.text()` on one would mangle it into
 * lone-surrogate nonsense and the failure would surface much later, as an
 * unreadable presentation rather than a mis-read file.
 */

/** Whether a picked file is a PowerPoint presentation. Extension first: a
 * `.pptx` copied off a memory stick often arrives with no type at all, and
 * the name is what the instructor actually chose. */
export const isPptx = (file: File): boolean =>
  /\.pptx$/i.test(file.name) ||
  file.type ===
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/** A PowerPoint file's bytes, base64-encoded for the JSON action layer. */
export const readAsBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Chunked: spreading a multi-megabyte array into `String.fromCharCode`
  // overflows the argument limit, and a deck full of pictures reaches that
  // easily.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
