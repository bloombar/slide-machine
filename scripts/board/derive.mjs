/**
 * derive.mjs — build/refresh the board manifest from the spec docs.
 *
 * Reads docs/SPEC.md (requirement ids + titles + sections) and docs/ROADMAP.md
 * (phase scope + done/outstanding status), and writes scripts/board/manifest.yaml
 * — the human-curated source of truth that sync.mjs pushes to GitHub.
 *
 * Merge semantics: on re-run, titles/sections/families are refreshed from the
 * SPEC, but any human-set phase/status/review on an existing entry is PRESERVED.
 * New ids are added with a best-effort phase/status (flagged review when unsure);
 * ids that vanished from the SPEC are kept and reported as stale.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { PHASES } from './config.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const SPEC = join(root, 'docs', 'SPEC.md')
const ROADMAP = join(root, 'docs', 'ROADMAP.md')
const MANIFEST = join(here, 'manifest.yaml')

const familyOf = id => id.replace(/-\d+.*$/, '')

// Requirements deliberately NOT tracked as their own board issues because they
// are fully realized by another tracked requirement (avoids duplication).
// P-12 = admin allowlist (ADMIN-1); P-13 = admin audit trail (ADMIN-7).
const EXCLUDE = new Set(['P-12', 'P-13'])

/** Trim to a word boundary with an ellipsis, for tidy issue titles. */
const shorten = (s, max) => {
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  return (
    s
      .slice(0, max)
      .replace(/\s+\S*$/, '')
      .replace(/[\s—:,;(-]+$/, '') + '…'
  )
}

/**
 * Expand a run of prose into concrete ids. Handles the two ROADMAP shorthands:
 * ranges (`QUIZ-1..6`) and slash-lists (`SEED-1/2/3`, `AUTH-3/4`). A bare number
 * continues the previous family ONLY when joined by `/` or `..`, so stray numbers
 * like "2–3 templates" or "100% coverage" are ignored.
 */
const expandIds = text => {
  // Drop markdown link targets and code backticks so both the linked scope
  // paragraphs and the plain code-span status lines reduce to the same shape.
  const flat = text.replace(/\]\([^)]*\)/g, '').replace(/[`[\]]/g, '')
  const out = []
  const re = /([A-Z]+-\d+|\d+)/g
  let m
  let curFam = null
  let prevNum = null
  let prevEnd = 0
  while ((m = re.exec(flat))) {
    const sep = flat.slice(prevEnd, m.index)
    prevEnd = re.lastIndex
    const tok = m[1]
    const isRange = /\.\./.test(sep)
    const joined = /\/|\.\./.test(sep) // '/' or '..' only — NOT a lone sentence period
    let fam
    let num
    if (tok.includes('-')) {
      fam = tok.replace(/-\d+$/, '')
      num = Number(tok.slice(tok.lastIndexOf('-') + 1))
    } else {
      if (!curFam || !joined) {
        continue // unrelated bare number
      }
      fam = curFam
      num = Number(tok)
    }
    if (isRange && prevNum != null && fam === curFam) {
      for (let n = prevNum + 1; n <= num; n++) out.push(`${fam}-${n}`)
    } else {
      out.push(`${fam}-${num}`)
    }
    curFam = fam
    prevNum = num
  }
  return out
}

/** Grab the section body between a heading match and the next heading/blank-run. */
const sliceSection = (text, headingRe, stopRe = /^#{2,4}\s/m) => {
  const start = text.search(headingRe)
  if (start < 0) return ''
  const rest = text.slice(start)
  const after = rest.slice(rest.indexOf('\n') + 1)
  const stop = after.search(stopRe)
  return stop < 0 ? after : after.slice(0, stop)
}

/** Flatten a chunk of markdown to plain prose for an issue body. */
const cleanMd = s =>
  s
    .replace(/```[\s\S]*?```/g, ' ') // drop fenced code blocks
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> their label text
    .replace(/^\s*[-+*]\s+/gm, ' ') // list bullet markers
    .replace(/[*`>#|]/g, '') // emphasis / heading / quote / table pipes
    .replace(/\s+/g, ' ')
    .trim()

// ---- Parse SPEC: id -> { title, full?, section, family } in document order ----
// Two markdown shapes are handled structurally (not hard-coded per id): a
// requirement SUBHEADING (`#### <ID> <title>` plus the prose beneath it, up to
// the next heading) and a §16 TABLE ROW (`| **P-1** | cell |`). In both cases
// `title` is the short label and `full` is the item's complete text, which sync
// renders into the issue body.
const parseSpec = text => {
  const items = []
  let section = ''
  let cur = null // heading item currently collecting its body prose

  const flush = () => {
    if (!cur) return
    const full = shorten(cleanMd(cur.body.join('\n')), 700)
    if (full && full !== cur.item.title) cur.item.full = full
    items.push(cur.item)
    cur = null
  }

  for (const line of text.split('\n')) {
    const sec = line.match(/^###\s+(\d+)\.\s+(.+?)\s*$/)
    if (sec) {
      flush()
      section = `§${sec[1]} ${sec[2]}`
      continue
    }
    const head = line.match(/^####\s+([A-Z]+-\d+[a-z]?)\s+(.+?)\s*$/)
    if (head) {
      flush()
      cur = {
        item: {
          id: head[1],
          title: head[2].trim(),
          section,
          family: familyOf(head[1]),
        },
        body: [],
      }
      continue
    }
    if (/^#{1,6}\s/.test(line)) {
      flush() // any other heading ends the current item's body
      continue
    }
    // §16 privacy table rows: | **P-1** | description ... |
    const prow = line.match(/^\|\s*\*\*(P-\d+)\*\*\s*\|\s*(.+?)\s*\|\s*$/)
    if (prow) {
      const cell = cleanMd(prow[2])
      const title = shorten(cell.split(/(?<=\.)\s/)[0], 72)
      const full = shorten(cell, 800)
      items.push({
        id: prow[1],
        title,
        ...(full !== title ? { full } : {}),
        section: section || '§16 Privacy, Security & Compliance',
        family: 'P',
      })
      continue
    }
    if (cur) cur.body.push(line)
  }
  flush()
  return items
}

// ---- Parse §18 Future Work bullets -> stable FUTURE-<slug> keys ----
const parseFuture = text => {
  const body = sliceSection(text, /^###\s+18\.\s+Future Work/m)
  const out = []
  for (const line of body.split('\n')) {
    const b = line.match(/^-\s+(.+)$/)
    if (!b) continue
    const lead = b[1].match(/^\*\*(.+?)\*\*/) // bold lead phrase, if any
    const raw = (lead ? lead[1] : b[1])
      .replace(/\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/[*`]/g, '')
    const words = raw.split(/\s+/).slice(0, 5).join(' ')
    const slug = words
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40)
    if (!slug) continue
    const title = shorten(raw.replace(/\s+—.*$/, ''), 80)
    const full = shorten(cleanMd(b[1]), 800)
    out.push({
      id: `FUTURE-${slug}`,
      title,
      ...(full !== title ? { full } : {}),
      section: '§18 Future Work',
      family: 'FUTURE',
    })
  }
  return out
}

// ---- Parse ROADMAP: best-effort phase + status seeds ----
const parseRoadmap = text => {
  const phaseOf = new Map()
  const status = new Map()
  const flags = new Map()

  const flag = (id, why) => flags.set(id, why)
  const setPhase = (id, p) => {
    if (phaseOf.has(id) && phaseOf.get(id) !== p) {
      flag(id, `spans phases ${phaseOf.get(id)} and ${p}`)
      return // keep the earliest phase
    }
    if (!phaseOf.has(id)) phaseOf.set(id, p)
  }

  // Phase from the Foundations bullets (§4 => phase 1) and the three scope paragraphs.
  for (const id of expandIds(sliceSection(text, /^##\s+4\.\s+Foundations/m)))
    setPhase(id, 1)
  const scope = (secRe, p) => {
    const body = sliceSection(text, secRe)
    const line = body.split('\n').find(l => /\*\*In scope/.test(l)) || ''
    for (const id of expandIds(line)) setPhase(id, p)
  }
  scope(/^##\s+5\.\s+Phase 1/m, 1)
  scope(/^##\s+6\.\s+Phase 2/m, 2)
  scope(/^##\s+7\.\s+Phase 3/m, 3)
  scope(/^##\s+8\.\s+Phase 4/m, 4)

  // Status from the "Current status" snapshot: Done vs Outstanding lists.
  const snap = sliceSection(text, /^###\s+Current status/m, /^##\s/m)
  const doneLine = l => /Done:/.test(l) || /Delivered early/.test(l)
  for (const line of snap.split('\n')) {
    if (!/^-\s/.test(line)) continue
    const ids = expandIds(line)
    const s = doneLine(line)
      ? 'Done'
      : /Outstanding:/.test(line)
        ? 'Backlog'
        : null
    if (!s) continue
    for (const id of ids) if (!status.has(id)) status.set(id, s)
  }

  return { phaseOf, status, flags }
}

// ---- Special-case overrides (the messy ids surfaced during analysis) ----
const applyOverrides = byId => {
  const set = (id, phase, status, review, why) => {
    const e = byId.get(id)
    if (!e) return
    e._seedPhase = phase
    e._seedStatus = status
    if (review) e._seedReview = true
    if (why) e._why = why
  }
  // Delivered ahead of their planned Phase 3 slot.
  for (const id of ['GEN-4', 'PLAY-2', 'EDIT-4'])
    set(id, 2, 'Done', false, 'delivered early')
  // Placed in Phase 2 (ROADMAP §6); previously unmapped in the roadmap.
  set('IMG-5', 2, 'Backlog', false, 'image attribution & licensing display')
  set('TECH-4', 2, 'Done', false, 'server configuration')
  set('TECH-9', 2, 'Backlog', false, 'billing-provider abstraction layer')
  // ADMIN family is Phase 2 work (ROADMAP §6): done ones Done, rest Backlog.
  const adminDone = new Set(['ADMIN-1', 'ADMIN-2', 'ADMIN-4', 'ADMIN-7'])
  for (const e of byId.values()) {
    if (e.family !== 'ADMIN') continue
    const done = adminDone.has(e.id)
    set(
      e.id,
      2,
      done ? 'Done' : 'Backlog',
      false,
      'administration & moderation',
    )
  }
  // Split ids: base ships in an early phase; a suffixed entry tracks the GitHub
  // remainder on the Phase-3 board so outstanding work is visible there.
  const splits = [
    {
      base: 'AUTH-1',
      sub: 'AUTH-1a',
      title: 'GitHub sign-in',
      section: '§4 Accounts & Authentication',
    },
    {
      base: 'EXP-4',
      sub: 'EXP-4a',
      title: 'GitHub connect (import/export)',
      section: '§11 Export/Import, Voting & Social',
    },
  ]
  for (const { base, sub, title, section } of splits) {
    const b = byId.get(base)
    if (b) {
      b._seedReview = true
      b._why = 'split id — GitHub part tracked separately'
    }
    if (!byId.has(sub)) {
      byId.set(sub, {
        id: sub,
        title,
        section,
        family: familyOf(sub),
        _seedPhase: 3,
        _seedStatus: 'Backlog',
        _seedReview: true,
        _why: 'GitHub remainder of ' + base,
        _synthetic: true,
      })
    }
  }
}

// ---- Assemble & merge with any existing manifest ----
const run = () => {
  const specText = readFileSync(SPEC, 'utf8')
  const roadText = readFileSync(ROADMAP, 'utf8')

  const specItems = [...parseSpec(specText), ...parseFuture(specText)].filter(
    i => !EXCLUDE.has(i.id),
  )
  const byId = new Map(specItems.map(i => [i.id, { ...i }]))
  const road = parseRoadmap(roadText)

  // Seed phase/status from the roadmap parse.
  for (const e of byId.values()) {
    if (e.family === 'FUTURE') {
      e._seedPhase = 4
      e._seedStatus = 'Backlog'
      continue
    }
    e._seedPhase = road.phaseOf.get(e.id) ?? null
    e._seedStatus =
      road.status.get(e.id) ?? (e._seedPhase === 1 ? 'Done' : 'Backlog')
    if (road.flags.has(e.id)) {
      e._seedReview = true
      e._why = road.flags.get(e.id)
    }
    if (e._seedPhase == null) {
      e._seedReview = true
      e._why = e._why || 'no phase found in roadmap'
    }
  }
  applyOverrides(byId)

  // Preserve human curation from an existing manifest.
  const prev = existsSync(MANIFEST) ? parse(readFileSync(MANIFEST, 'utf8')) : []
  const prevById = new Map((prev || []).map(e => [e.id, e]))

  const entries = []
  for (const e of byId.values()) {
    const old = prevById.get(e.id)
    entries.push({
      id: e.id,
      title: e.title,
      // `full` is the complete spec text (refreshed from the SPEC each run),
      // shown in the issue body when the short title is a clipped version.
      ...(e.full ? { full: e.full } : {}),
      section: e.section,
      family: e.family,
      phase: old ? old.phase : e._seedPhase,
      status: old ? old.status : e._seedStatus,
      review: old ? Boolean(old.review) : Boolean(e._seedReview),
      ...(e._why && !old
        ? { note: e._why }
        : old && old.note
          ? { note: old.note }
          : {}),
    })
  }
  // Keep (but warn about) manifest entries no longer in the SPEC.
  const stale = []
  for (const old of prev || []) {
    if (!byId.has(old.id)) {
      stale.push(old.id)
      entries.push(old)
    }
  }

  // Stable ordering: by phase, then family, then numeric id.
  const numOf = id => Number((id.match(/-(\d+)/) || [])[1] || 0)
  entries.sort(
    (a, b) =>
      (a.phase ?? 9) - (b.phase ?? 9) ||
      a.family.localeCompare(b.family) ||
      numOf(a.id) - numOf(b.id) ||
      a.id.localeCompare(b.id),
  )

  const header =
    '# Board manifest — SOURCE OF TRUTH for the GitHub project board.\n' +
    '# Generated by scripts/board/derive.mjs, then hand-curated. Re-running derive\n' +
    '# preserves your phase/status/review edits. Resolve every `review: true` row,\n' +
    '# then run scripts/board/sync.mjs. Do not edit ids (they key the issues).\n\n'
  writeFileSync(MANIFEST, header + stringify(entries))

  // Report.
  const byPhase = Object.fromEntries(PHASES.map(p => [p, 0]))
  let noPhase = 0
  let review = 0
  for (const e of entries) {
    if (e.phase == null) noPhase++
    else byPhase[e.phase] = (byPhase[e.phase] || 0) + 1
    if (e.review) review++
  }
  console.log(`Wrote ${entries.length} entries to ${MANIFEST}`)
  console.log(
    `  by phase: ${PHASES.map(p => `P${p}=${byPhase[p]}`).join('  ')}  none=${noPhase}`,
  )
  console.log(`  needing review: ${review}`)
  const news = entries.filter(e => !prevById.has(e.id)).map(e => e.id)
  if (prev && prev.length)
    console.log(
      `  new since last run: ${news.length ? news.join(', ') : 'none'}`,
    )
  if (stale.length)
    console.log(`  STALE (in manifest, not in SPEC): ${stale.join(', ')}`)
}

run()
