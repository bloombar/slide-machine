/**
 * Minimal CSV serialization for the audit log export. Hand-rolled on
 * purpose — the project has no CSV dependency and only ever writes CSV,
 * never parses it.
 */

/**
 * Serializes one value as a CSV field. null/undefined become the empty
 * field. Fields containing quotes, commas, or newlines are quote-wrapped
 * with internal quotes doubled (RFC 4180). Fields starting with = + - @
 * get a leading apostrophe so spreadsheet apps don't execute them as
 * formulas (emails and details can be user-influenced).
 */
export const csvField = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  if (/[",\n\r]/.test(text)) text = `"${text.replaceAll('"', '""')}"`
  return text
}

/** Serializes one row of values as a CRLF-terminated CSV line. */
export const csvRow = (fields: unknown[]): string =>
  fields.map(csvField).join(',') + '\r\n'
