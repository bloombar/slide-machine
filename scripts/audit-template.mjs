/**
 * audit-template.mjs — check a template for defects in its own data.
 *
 * WHY THIS EXISTS
 * The same rules run over every built-in as a test (`server/src/templates/
 * audit.test.ts`), which stops a bad design being committed. But a template
 * being *derived* — the output of importing someone's deck — is not committed
 * anywhere, and that is exactly when its faults are cheapest to find. This is
 * the manual door onto the same checker: point it at a template JSON and it
 * tells you what is wrong with it.
 *
 * WHAT IT CAN AND CANNOT TELL YOU
 * It reads the template. So it can say a design is self-consistent — boxes on
 * the slide, words not on top of each other, styles that exist, text readable
 * against what is behind it. It can NEVER say the design matches the deck it
 * came from: a template whose every colour was misread will pass cleanly.
 * Only rendering it beside its source catches that.
 *
 * USAGE
 *   npx tsx scripts/audit-template.mjs <template.json>
 *
 * Exits non-zero if there are faults, so it can gate a script.
 */
import { readFileSync } from 'node:fs'
import { auditTemplate } from '../server/src/templates/audit.ts'

const [file] = process.argv.slice(2)
if (!file) {
  console.error('usage: npx tsx scripts/audit-template.mjs <template.json>')
  process.exit(2)
}

const template = JSON.parse(readFileSync(file, 'utf8'))
const { faults, notes } = auditTemplate(template)
const where = f => [f.layout, f.box].filter(Boolean).join('.')

console.log(`${file} — ${template.layouts?.length ?? 0} layouts`)
for (const fault of faults)
  console.log(`  FAULT [${fault.rule}] ${where(fault)} ${fault.message}`)
// Notes are things the data cannot settle — anything under a picture — and
// things a design may legitimately do. Shown, never counted against it.
for (const note of notes)
  console.log(`  note  [${note.rule}] ${where(note)} ${note.message}`)
console.log(`\n${faults.length} fault(s), ${notes.length} note(s)`)
process.exit(faults.length ? 1 : 0)
