#!/usr/bin/env node
/**
 * Imports a directory of remark.js lecture sources into the app as a project
 * full of pre-saved lecture decks.
 *
 * The knowledge.kitchen course notes are markdown written for remark.js. This
 * reads a course's `slides/` directory, converts each file into slides on the
 * app's own model, and saves them through the ordinary action API — so the
 * result is a set of lectures an instructor can open, edit, and speak over.
 *
 * It is deliberately source-agnostic: point it at any directory of files in
 * the same format and it will build the matching project.
 *
 *   node scripts/course-import/import-course.mjs \
 *     --dir ~/knowledge-kitchen/content/courses/software-engineering/slides \
 *     --base-url http://localhost:3000 --email me@example.com
 *
 * Re-running is safe: a lecture whose title is already in the project is
 * skipped, so an interrupted import can be resumed by running it again.
 */
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { parseDeck } from './parse-remark.mjs'
import { deckToSlides } from './to-slides.mjs'
import { makeUrlResolver } from './assets.mjs'
import { materialsFor } from './materials.mjs'
import { readCourseDescription } from './syllabus.mjs'
import { createClient, ApiError } from './client.mjs'

const USAGE = `
Import a directory of remark.js lecture sources as a project of saved decks.

Required
  --dir <path>            Directory holding the lecture .md files

Target app
  --base-url <url>        App origin (default $SLIDE_MACHINE_URL or http://localhost:3000)
  --email <address>       Sign-in email (default $SLIDE_MACHINE_EMAIL)
  --password <secret>     Sign-in password (default $SLIDE_MACHINE_PASSWORD, else prompted)
  --token <jwt>           Access token to use instead of a password (default
                          $SLIDE_MACHINE_TOKEN); for an account signed in with
                          Google, which has no password to send

Project
  --project <title>       Project title (default: derived from the directory)
  --course <name>         Course name stored on the project
  --description <text>    Project description (default: the course syllabus's)
  --syllabus <path>       Syllabus to read the description from
                          (default: syllabus.md beside the lecture directory)
  --template <id>         Style template for the project (e.g. classic, midnight, seminar)
  --study-label <text>    Research-study tag set on every lecture (admin only)

Source URLs
  --site-base <url>       Site the sources are published on (default https://knowledge.kitchen)
  --course-path <path>    Course path on that site (default: derived from --dir)

Seed material
  --no-seed-material      Do not upload the files the lectures link to
  --material-timeout <s>  Seconds to wait for extraction before captioning (default 30)

Selection & output
  --replace               Delete a lecture already in the project and rebuild it
  --only <a,b>            Only these files (basenames, with or without .md)
  --limit <n>             Import at most n lectures
  --order <a,b>           Lecture order, by basename; unlisted files follow alphabetically
  --concurrency <n>       Lectures built in parallel (default 3)
  --continuation <text>   Marker appended to a split slide's title (default " (cont.)")
  --dry-run               Convert and report without writing anything
  --out <dir>             Write the converted slides as JSON (for review or --dry-run)
  -h, --help              Show this message
`

/** Parses `--flag value` and `--flag=value` argv into an object. */
export const parseArgs = argv => {
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('-')) continue
    if (arg === '-h' || arg === '--help') {
      opts.help = true
      continue
    }
    const [flag, inline] = arg.replace(/^--?/, '').split(/=(.*)/s)
    const key = flag.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())
    if (inline !== undefined) {
      opts[key] = inline
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      opts[key] = argv[++i]
    } else {
      opts[key] = true
    }
  }
  return opts
}

/** "software-engineering" → "Software Engineering". */
export const titleFromSlug = slug =>
  slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

/**
 * Works out where the sources are published from their path on disk.
 *
 * The course notes live under `content/courses/<course>/slides`, and that
 * same shape is the URL they are served at — so the path below `content/`
 * is the course path on the site. Anything not in that shape falls back to
 * the parent directory's name, which the caller can override.
 */
export const deriveCoursePath = dir => {
  const parts = path.resolve(dir).split(path.sep)
  const anchor = parts.lastIndexOf('content')
  if (anchor !== -1) {
    const tail = parts.slice(anchor, -1) // drop the trailing "slides"
    return tail.join('/')
  }
  return parts[parts.length - 2] ?? ''
}

/** Lecture files, in the requested order then alphabetically. */
export const listLectures = (dir, { only, order } = {}) => {
  const stem = name => name.replace(/\.md$/i, '')
  let files = fs
    .readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))

  if (only) {
    const wanted = new Set(only.split(',').map(s => stem(s.trim())))
    files = files.filter(f => wanted.has(stem(f)))
  }
  if (order) {
    const rank = new Map(order.split(',').map((s, i) => [stem(s.trim()), i]))
    files.sort((a, b) => {
      const ra = rank.has(stem(a)) ? rank.get(stem(a)) : Infinity
      const rb = rank.has(stem(b)) ? rank.get(stem(b)) : Infinity
      return ra === rb ? a.localeCompare(b) : ra - rb
    })
  }
  return files
}

/** Reads a password without echoing it, for an interactive run. */
const promptPassword = () =>
  new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    const onData = char => {
      if (char.toString() === '\n' || char.toString() === '\r') return
      readline.moveCursor(process.stdout, -1, 0)
      process.stdout.write('*')
    }
    process.stdin.on('data', onData)
    rl.question('Password: ', answer => {
      process.stdin.off('data', onData)
      process.stdout.write('\n')
      rl.close()
      resolve(answer)
    })
  })

/** Runs `worker` over `items`, at most `limit` at a time. */
const pool = async (items, limit, worker) => {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(limit, items.length)) },
      async () => {
        while (next < items.length) {
          const i = next++
          results[i] = await worker(items[i], i)
        }
      },
    ),
  )
  return results
}

/**
 * A one-line summary of a lecture, read from its frontmatter alone — enough
 * for the project's seed context without converting the whole file.
 */
export const outlineOf = (dir, file) => {
  const { title, description } = parseDeck(
    fs.readFileSync(path.join(dir, file), 'utf8'),
  )
  const name = title || titleFromSlug(file.replace(/\.md$/i, ''))
  return description ? `${name} — ${description}` : name
}

/** Converts one source file into a titled deck of app slides. */
export const convertLecture = (
  file,
  dir,
  { siteBase, coursePath, template, continuation, seedMaterial = true },
) => {
  const source = fs.readFileSync(path.join(dir, file), 'utf8')
  const parsed = parseDeck(source)
  const deckName = file.replace(/\.md$/i, '')
  const resolve = makeUrlResolver({ siteBase, coursePath, deckName })
  const title = parsed.title || titleFromSlug(deckName)
  // The pictures and documents the lecture links to become its seed material,
  // so what the instructor already gathered is what generation draws on.
  const materials = seedMaterial
    ? materialsFor(parsed, { dir, deckName, lectureTitle: title, resolve })
    : { uploads: [], skipped: [] }
  return {
    file,
    deckName,
    title,
    description: parsed.description,
    slides: deckToSlides(parsed, { resolve, template, continuation }),
    materials,
  }
}

/**
 * Uploads a lecture's linked files as its seed material and labels each one.
 *
 * The label matters as much as the file: an uploaded picture is offered to
 * generation by its caption and the keywords derived from it, so a caption
 * built from the slide it illustrates is what makes it findable. Captions
 * are applied *after* extraction finishes, because extraction saves the
 * asset itself and would otherwise race with the update.
 *
 * Re-runnable: material already attached to the lecture under the same name
 * is left alone, so a second run adds only what is missing.
 */
export const uploadMaterials = async (
  client,
  { projectId, deckId, uploads, timeoutMs = 30_000, log = () => {} },
) => {
  if (!uploads.length)
    return { uploaded: 0, skipped: 0, failed: 0, bytes: 0, byUrl: new Map() }

  const existing = await client
    .act('seedAsset.list', { deckId })
    .catch(() => [])
  const have = new Set(existing.map(a => a.name))

  const created = []
  const byUrl = new Map()
  let skipped = 0
  let failed = 0
  let bytes = 0

  for (const item of uploads) {
    if (have.has(item.name)) {
      skipped++
      continue
    }
    try {
      const asset = await client.upload({
        buffer: fs.readFileSync(item.filePath),
        filename: item.name,
        mime: item.mime,
        fields: { projectId, deckId },
      })
      created.push({ ...item, id: asset.id })
      // Images are served by the app the moment they are stored, so a slide
      // can point at this copy instead of the published site.
      if (asset.imageUrl && item.resolvedUrl)
        byUrl.set(item.resolvedUrl, asset.imageUrl)
      bytes += item.size
      have.add(item.name)
    } catch (err) {
      failed++
      log(`         material ${item.name}: ${err.message}`)
    }
  }

  if (!created.length) return { uploaded: 0, skipped, failed, bytes, byUrl }

  // Extraction runs fire-and-forget on the server and saves the asset when it
  // finishes; waiting for that keeps it from overwriting the caption below.
  const deadline = Date.now() + timeoutMs
  const pending = new Set(created.map(a => a.id))
  while (pending.size && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    const assets = await client
      .act('seedAsset.list', { deckId })
      .catch(() => [])
    for (const asset of assets) {
      if (asset.status === 'ready' || asset.status === 'failed') {
        pending.delete(asset.id)
      }
    }
  }

  for (const item of created) {
    try {
      await client.act('seedAsset.update', {
        assetId: item.id,
        caption: item.caption,
      })
    } catch (err) {
      log(`         caption for ${item.name}: ${err.message}`)
    }
  }

  return { uploaded: created.length, skipped, failed, bytes, byUrl }
}

/**
 * Reports the linked files that could not become seed material, grouped by
 * why — a remote PDF, a format the upload route refuses, a path that does
 * not resolve. Counts only, unless there are few enough to name.
 */
const reportUnusable = skipped => {
  if (!skipped.length) return
  const reasons = {
    remote: 'linked off-site',
    missing: 'not found on disk',
    unsupported: 'unsupported format',
    'too-large': 'over the 20 MB limit',
  }
  const byReason = {}
  for (const item of skipped) {
    ;(byReason[item.reason] ??= []).push(item)
  }
  console.log(`\n${skipped.length} linked files not imported as material:`)
  for (const [reason, items] of Object.entries(byReason)) {
    console.log(`  ${items.length} ${reasons[reason] ?? reason}`)
    if (items.length <= 5) {
      for (const item of items) console.log(`      ${item.url}`)
    }
  }
}

/**
 * Points a slide's picture box at the uploaded copy of its picture.
 *
 * The box was given a URL on the published course site, because that is where
 * the source's own paths point. The site is built from its own revision of the
 * notes, so a picture the local source names may not be served there at all —
 * and a box holding a dead URL shows nothing and, counting as filled, is never
 * sourced an image either. The uploaded copy is the file the instructor
 * actually has, so it is what the slide should show.
 */
export const repointPictures = async (client, boxes, byUrl) => {
  if (!byUrl?.size) return 0
  let moved = 0
  for (const box of boxes) {
    const uploaded = byUrl.get(box.ref)
    if (!uploaded || uploaded === box.ref) continue
    try {
      await client.act('slide.editContent', {
        slideId: box.slideId,
        slots: {
          [box.name]: { kind: 'image', ref: uploaded, source: 'seeded' },
        },
      })
      moved++
    } catch {
      // The slide keeps the site URL; the picture is still attached as
      // material, so the lecture is not left without it.
    }
  }
  return moved
}

/** Bytes as a short "1.2 MB" for the run's reporting. */
const formatMb = bytes => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

const main = async () => {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help || !opts.dir) {
    console.log(USAGE)
    process.exit(opts.help ? 0 : 1)
  }

  const dir = path.resolve(opts.dir)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`Not a directory: ${dir}`)
    process.exit(1)
  }

  const siteBase = opts.siteBase ?? 'https://knowledge.kitchen'
  const coursePath = opts.coursePath ?? deriveCoursePath(dir)
  const courseSlug = path.basename(path.dirname(dir))
  const projectTitle = opts.project ?? titleFromSlug(courseSlug)
  const continuation =
    opts.continuation === undefined ? ' (cont.)' : String(opts.continuation)
  const seedMaterial = !opts.noSeedMaterial
  const materialTimeoutMs = Number(opts.materialTimeout ?? 30) * 1000
  // The syllabus says what the course is; fall back to naming the source, so
  // a course without one still gets a description that means something.
  const description =
    (typeof opts.description === 'string' ? opts.description.trim() : '') ||
    readCourseDescription(dir, {
      syllabusPath: typeof opts.syllabus === 'string' ? opts.syllabus : null,
    }) ||
    `Lecture notes imported from ${path.basename(dir)}.`

  let files = listLectures(dir, { only: opts.only, order: opts.order })
  if (opts.limit) files = files.slice(0, Number(opts.limit))
  if (!files.length) {
    console.error(`No .md lecture files found in ${dir}`)
    process.exit(1)
  }

  console.log(`Source:  ${dir}`)
  console.log(`Assets:  ${siteBase}/${coursePath}/slides/<lecture>/`)
  console.log(`Project: ${projectTitle}`)
  console.log(`Files:   ${files.length}`)
  console.log(`About:   ${description.split('\n')[0].slice(0, 96)}\n`)

  // --- Dry run: convert and report, touching nothing -----------------------
  if (opts.dryRun) {
    let total = 0
    const byLayout = {}
    const material = []
    const unusable = []
    for (const file of files) {
      const deck = convertLecture(file, dir, {
        siteBase,
        coursePath,
        continuation,
        seedMaterial,
      })
      total += deck.slides.length
      for (const slide of deck.slides) {
        byLayout[slide.layoutType] = (byLayout[slide.layoutType] ?? 0) + 1
      }
      material.push(...deck.materials.uploads)
      unusable.push(...deck.materials.skipped)
      const found = deck.materials.uploads.length
      console.log(
        `  ${String(deck.slides.length).padStart(4)}  ${deck.title}` +
          `${found ? `  (+${found} files)` : ''}`,
      )
      if (opts.out) writeJson(opts.out, deck)
    }
    console.log(`\n${total} slides across ${files.length} lectures`)
    console.log(
      Object.entries(byLayout)
        .sort((a, b) => b[1] - a[1])
        .map(([type, n]) => `  ${type}: ${n}`)
        .join('\n'),
    )
    if (seedMaterial) {
      const bytes = material.reduce((n, m) => n + m.size, 0)
      console.log(
        `\n${material.length} seed-material files (${formatMb(bytes)})`,
      )
      for (const item of material) {
        console.log(`  ${item.name}\n      ${item.caption}`)
      }
      reportUnusable(unusable)
    }
    return
  }

  // --- Sign in -------------------------------------------------------------
  const baseUrl =
    opts.baseUrl ?? process.env.SLIDE_MACHINE_URL ?? 'http://localhost:3000'
  const email = opts.email ?? process.env.SLIDE_MACHINE_EMAIL
  const token = opts.token ?? process.env.SLIDE_MACHINE_TOKEN
  if (!email && !token) {
    console.error(
      'An account is required: pass --email or --token, or set ' +
        'SLIDE_MACHINE_EMAIL or SLIDE_MACHINE_TOKEN',
    )
    process.exit(1)
  }
  // A token identifies the account by itself, so it is not accompanied by a
  // password prompt the holder could not answer anyway.
  const password = token
    ? undefined
    : (opts.password ??
      process.env.SLIDE_MACHINE_PASSWORD ??
      (await promptPassword()))

  const client = await createClient({ baseUrl, email, password, token })
  console.log(
    `Signed in to ${baseUrl} as ${
      client.user.displayName ?? client.user.email ?? email
    }\n`,
  )

  // --- Project -------------------------------------------------------------
  const projects = await client.act('project.list', {})
  let project = projects.find(p => p.title === projectTitle)
  if (project) {
    console.log(`Reusing existing project "${projectTitle}" (${project.id})`)
    // Only fill a blank one: a description edited in the app is the owner's,
    // and a re-run is not a reason to overwrite it.
    if (!project.description?.trim()) {
      project = await client.act('project.update', {
        projectId: project.id,
        description,
      })
      console.log('Set the project description from the syllabus')
    }
  } else {
    project = await client.act('project.create', {
      title: projectTitle,
      course: opts.course ?? projectTitle,
      description,
      // The lecture list is the project's seed context, so live generation
      // during a lecture knows what the course covers (SEED-1/PREP-3).
      seedContext: files.map(f => outlineOf(dir, f)).join('\n'),
    })
    console.log(`Created project "${projectTitle}" (${project.id})`)
  }

  if (opts.template && opts.template !== project.templateId) {
    project = await client.act('project.switchTemplate', {
      projectId: project.id,
      templateId: opts.template,
    })
    console.log(`Project template set to ${project.templateId}`)
  }

  // The template decides which layouts exist and how much fits on one, so it
  // is read once and the conversion is paginated to its real limits.
  let template
  try {
    template = await client.act('template.get', { slug: project.templateId })
  } catch (err) {
    console.warn(
      `Could not read template "${project.templateId}" (${err.message}); using built-in defaults.`,
    )
  }

  const existing = await client.act('deck.list', { projectId: project.id })
  const existingByTitle = new Map(existing.map(d => [d.title, d.id]))

  // --- Lectures ------------------------------------------------------------
  const results = await pool(
    files,
    Number(opts.concurrency ?? 3),
    async file => {
      const deck = convertLecture(file, dir, {
        siteBase,
        coursePath,
        template,
        continuation,
        seedMaterial,
      })
      if (opts.out) writeJson(opts.out, deck)

      const already = existingByTitle.get(deck.title)
      if (already && !opts.replace) {
        console.log(`  skip   ${deck.title} — already in the project`)
        return { ...deck, skipped: true }
      }
      // --replace rebuilds the lecture from source rather than resuming
      // around it. The delete cascades to the old lecture's slides and its
      // seed material, and is a tombstone rather than an erasure — the app
      // can restore it if the new import turns out worse than the old one.
      if (already) {
        try {
          await client.act('deck.delete', { deckId: already })
          console.log(`  replace ${deck.title} — old lecture deleted`)
        } catch (err) {
          console.error(
            `  FAIL   ${deck.title} — could not replace: ${err.message}`,
          )
          return { ...deck, error: `could not replace: ${err.message}` }
        }
      }

      try {
        const created = await client.act('deck.create', {
          projectId: project.id,
          title: deck.title,
        })

        // Slides are added in order: each `slide.add` appends to the deck's
        // slide order, so this one deck's slides are built sequentially even
        // though several lectures are built at once.
        const pictureBoxes = []
        for (const slide of deck.slides) {
          const added = await client.act('slide.add', {
            deckId: created.id,
            layoutType: slide.layoutType,
          })
          await client.act('slide.editContent', {
            slideId: added.id,
            slots: slide.slots,
          })
          for (const [name, value] of Object.entries(slide.slots)) {
            if (value.kind === 'image' && value.ref)
              pictureBoxes.push({ slideId: added.id, name, ref: value.ref })
          }
        }

        if (deck.description) {
          await client.act('deck.setSeedNotes', {
            deckId: created.id,
            seedContext: deck.description,
          })
        }
        if (opts.studyLabel) {
          try {
            await client.act('deck.setStudyLabel', {
              deckId: created.id,
              studyLabel: String(opts.studyLabel),
            })
          } catch (err) {
            // The study tag is admin-only (EVAL-3); an ordinary account can
            // still import, it just cannot label what it imports.
            console.warn(
              `  note   study label not set on "${deck.title}": ${err.message}`,
            )
          }
        }

        // Material is attached last: the lecture has to exist before a file
        // can hang off it, and a failure here must not lose the slides.
        let material = { uploaded: 0, skipped: 0, failed: 0, bytes: 0 }
        if (seedMaterial && deck.materials.uploads.length) {
          try {
            material = await uploadMaterials(client, {
              projectId: project.id,
              deckId: created.id,
              uploads: deck.materials.uploads,
              timeoutMs: materialTimeoutMs,
              log: console.warn,
            })
          } catch (err) {
            console.warn(
              `         material for "${deck.title}": ${err.message}`,
            )
          }
          await repointPictures(client, pictureBoxes, material.byUrl)
        }

        console.log(
          `  ok     ${deck.title} — ${deck.slides.length} slides` +
            `${material.uploaded ? `, ${material.uploaded} files` : ''}` +
            `  ${client.baseUrl}/d/${created.permalinkSlug}`,
        )
        return {
          ...deck,
          id: created.id,
          slug: created.permalinkSlug,
          material,
          replaced: Boolean(already),
        }
      } catch (err) {
        const detail =
          err instanceof ApiError ? `${err.code}: ${err.message}` : err.message
        console.error(`  FAIL   ${deck.title} — ${detail}`)
        return { ...deck, error: detail }
      }
    },
  )

  // --- Summary -------------------------------------------------------------
  const made = results.filter(r => r.id)
  const replaced = made.filter(r => r.replaced)
  const skipped = results.filter(r => r.skipped)
  const failed = results.filter(r => r.error)
  const slides = made.reduce((n, r) => n + r.slides.length, 0)

  console.log(
    `\n${made.length} lectures imported (${slides} slides)` +
      `${replaced.length ? `, ${replaced.length} replaced` : ''}` +
      `${skipped.length ? `, ${skipped.length} skipped` : ''}` +
      `${failed.length ? `, ${failed.length} failed` : ''}.`,
  )

  if (seedMaterial) {
    const material = made.reduce(
      (totals, r) => ({
        uploaded: totals.uploaded + (r.material?.uploaded ?? 0),
        skipped: totals.skipped + (r.material?.skipped ?? 0),
        failed: totals.failed + (r.material?.failed ?? 0),
        bytes: totals.bytes + (r.material?.bytes ?? 0),
      }),
      { uploaded: 0, skipped: 0, failed: 0, bytes: 0 },
    )
    if (material.uploaded || material.skipped || material.failed) {
      console.log(
        `${material.uploaded} seed-material files uploaded (${formatMb(material.bytes)})` +
          `${material.skipped ? `, ${material.skipped} already attached` : ''}` +
          `${material.failed ? `, ${material.failed} failed` : ''}.`,
      )
    }
    reportUnusable(made.flatMap(r => r.materials?.skipped ?? []))
  }

  console.log(`Project: ${client.baseUrl}/p/${project.id}`)
  if (failed.length) process.exitCode = 1
}

/** Writes a converted deck to `dir` as JSON, for review or diffing. */
const writeJson = (dir, deck) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${deck.deckName}.json`),
    `${JSON.stringify(deck, null, 2)}\n`,
  )
}

// Only run when invoked directly, so the helpers above stay testable.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err instanceof ApiError ? `${err.code}: ${err.message}` : err)
    process.exit(1)
  })
}
