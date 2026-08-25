#!/usr/bin/env npx tsx
/**
 * Builds `server/config/templates/nyu-bold.json` from NYU's captured deck.
 *
 *   cd server && npx tsx ../scripts/build-nyu-bold.ts
 *
 * From `server/`, because the import chain it runs loads the server's own
 * configuration and reads `server/.env` from the working directory. It never
 * touches the database: the deck comes from the captured fixture and the
 * output is a file.
 *
 * ## The shipped file is NOT importer output
 *
 * It is importer output PLUS a hand-written roster, and anyone who assumes
 * otherwise will misread every fidelity claim made about it. In particular
 * **the layout TYPE of each layout is written by the roster below, keyed on
 * source slide number — not by `ruleBasedType`.** What the importer decides to
 * call a slide never reaches this file. So a change to the naming rules can
 * move what a real user's import produces without moving anything here, and a
 * green comparison against this file says nothing about that.
 *
 * Everything in the output falls into one of three kinds, and which is which
 * is worth knowing before trusting any rectangle in it:
 *
 *   1. MEASURED. Rectangles, type sizes, colours, leading and budgets come
 *      from running the real importer over the captured deck. Nothing here is
 *      a figure anyone typed, and that is the point: the file is a build
 *      output, and `budget-consistency` checks it against the same
 *      instrument that produced it.
 *   2. AUTHORED, because the source could not be used. Marked AUTHORED at
 *      each site with the reason. There are four: the title slide's box is
 *      raised off its own subtitle, the seam rule on `image-heavy` is moved
 *      to abut the photograph, `big-number`'s figure box is given the height
 *      its own type needs, and `image-full`'s picture rectangle is invented
 *      outright because NYU's placeholder is empty and there was nothing to
 *      measure.
 *   3. AUTHORED, because the deck has no slide for it. Four layouts:
 *      `content-list`, `code`, `formula` and `whiteboard`. A design cannot be
 *      derived for a slide that does not exist, so these are additions in the
 *      deck's idiom rather than derivations of it — see docs/TEMPLATES.md §9.
 *
 * Two roster entries look measured and are not quite. `closing` is built from
 * a SECOND import run with nothing skipped: its source page is NYU's own
 * "how to use this template" instructions, which an import rightly leaves
 * out, while its rectangles are the deck's white idiom and are worth keeping.
 * And `image-full`'s image slot does not exist in the source at all (see 2).
 * Both cost real time to establish from the outside; they are written down
 * here so nobody has to establish them again.
 *
 * ## Why the pictures come from a file
 *
 * A derivation run has nowhere to store pictures, so it drops them. A run
 * that fetches them needs Google's own content URLs, and the ones in the
 * captured deck have long expired — so an import that fetches is not
 * reproducible and this script must not depend on one. `nyu-bold/
 * source-pictures.json` records what a run that DID fetch found: which
 * rectangle on which page carries which picture. The files themselves are in
 * the repo under `server/config/templates/assets/nyu-bold/`, and `ASSETS`
 * maps the fetched name to the repo name. Each piece is paired against the
 * fresh derivation by rectangle rather than trusted.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { CandidateSlot } from '../server/src/import/candidate'

/**
 * The importer is loaded on demand, not at the top of this file, and the
 * reason is the error message.
 *
 * Importing it pulls in the server's configuration, which reads `.env` from
 * the working directory and EXITS THE PROCESS if it does not validate — so
 * from the wrong directory this died on three lines about a missing
 * MONGODB_URI, in a script that never opens a database. Loading it on demand
 * leaves room to check the directory first and answer with the command that
 * works. A confusing death in the one script whose whole purpose is that
 * somebody else can rebuild the artifact is worth five minutes.
 */
const importer = async () => {
  // Checked BEFORE the import rather than caught after it: the configuration
  // does not throw when it fails to validate, it exits the process, so there
  // is nothing to catch. From the wrong directory that is three lines about a
  // missing MONGODB_URI in a script that never opens a database.
  const here = JSON.parse(
    readFileSync(new URL(`file://${process.cwd()}/package.json`), 'utf8'),
  ) as { name?: string }
  if (here.name !== '@slide-machine/server')
    throw new Error(
      'Run this from the server directory:\n\n' +
        '  cd server && npx tsx ../scripts/build-nyu-bold.ts\n\n' +
        'It loads the importer, which reads the server configuration from ' +
        '.env in the working directory. It does not use the database.',
    )
  const [read, presentation, metrics, text] = await Promise.all([
    import('../server/src/import/read-slides'),
    import('../server/src/import/import-presentation'),
    import('../server/src/import/text-metrics'),
    import('../shared/src/types/text-styles'),
  ])
  return {
    toSourcePresentation: read.toSourcePresentation,
    importSourcePresentation: presentation.importSourcePresentation,
    capacityOf: metrics.capacityOf,
    NATURAL_LINE_BOX: text.NATURAL_LINE_BOX,
  }
}

const FIXTURE = new URL(
  '../server/test/fixtures/presentation-nyu-bold.json',
  import.meta.url,
)
const PICTURES_FILE = new URL(
  './nyu-bold/source-pictures.json',
  import.meta.url,
)
const OUT = new URL('../server/config/templates/nyu-bold.json', import.meta.url)

/** The name a fetched picture was stored under, against the name it has in
 * the repo. */
const ASSETS: Record<string, string> = {
  '01ec90be1a6adbb2ff881576d4bf13d0.png': 'band-top.png',
  '81fa2c9bcb82b1471229cfeb4effc615.png': 'mark-section.png',
  '40003015a46006219f7f518347693de0.png': 'mark-grid.png',
  'c86d683b902e55d764f78de0b14116e8.png': 'logo.png',
  'c7302c6de3d3cd83c2274b5b6048b841.png': 'logo-white.png',
  '3d60c481fc43fef21c7b2699bf9da59d.jpg': 'photo-title.jpg',
  '7372bd57411248d937aea9decfd3d18e.jpg': 'photo-quote.jpg',
}

type Box = { x: number; y: number; w: number; h: number; [k: string]: unknown }
/** A decoration piece: a rectangle with a fill or a picture, and nothing an
 * author can edit. */
type Piece = {
  x: number
  y: number
  w: number
  h: number
  fill?: string
  imageUrl?: string
  shapeType?: string
}
/** A named text style, as the importer derives one. */
type Role = {
  fontSize: number
  lineHeight: number
  fontWeight?: number
  caps?: boolean
  fontFamily?: string
  color?: string
}
type Slot = {
  name: string
  kind: string
  label?: string
  description?: string
  multiline?: boolean
  maxChars?: number
  maxItems?: number
  required?: boolean
}
type Layout = {
  type: string
  label: string
  purpose: string
  slots: Slot[]
  elementPositions: Record<string, Box>
  decoration?: Record<string, unknown>[]
}

/** What a box is for, and whether a slide can do without it. */
interface Authored {
  label: string
  description: string
  required?: boolean
  /** An authored budget, where the derived one is measurably wrong. Used
   * once; the reason is written at the site. */
  maxChars?: number
}

/** One shipped layout: which source slide it is, what it is called, and what
 * each of its boxes is for. `slots` is also the order the boxes are written
 * in, which is the order they read on the slide.
 *
 * An entry with no `slide` is one of the four the deck has no slide for. */
interface Entry {
  slide?: number
  type: string
  label: string
  purpose: string
  slots: Record<string, Authored>
}

const ROSTER: Entry[] = [
  {
    slide: 1,
    type: 'title',
    label: 'Title',
    purpose: 'Opening slide: the lecture title over a photograph',
    slots: {
      title: {
        label: 'Title',
        description:
          'The lecture title, in capitals over the photograph. A few words, not a sentence.',
        required: true,
      },
      caption: {
        label: 'Subtitle',
        description: 'What the lecture is about, in one line.',
        required: false,
      },
      body: {
        label: 'Presenter',
        description: 'Who is presenting, and the date.',
        required: false,
      },
    },
  },
  {
    slide: 2,
    type: 'section',
    label: 'Section divider',
    purpose: 'A new part of the lecture begins',
    slots: {
      title: {
        label: 'Part title',
        description: 'The name of the part that follows, in capitals.',
        required: true,
      },
      caption: {
        label: 'Subtitle',
        description: 'One line on what this part covers.',
        required: false,
      },
      /*
       * The numeral, and it is the dominant graphic of the slide rather than
       * an extra.
       *
       * NYU sets it at 250pt across the right half of the page, bleeding to
       * the bottom edge. It was missing from every earlier build of this file
       * because the importer's ornament guard measured character CAPACITY —
       * a box's area divided by the square of its type — which goes low both
       * for a box that is tiny and for one whose type is enormous. At two
       * characters it went out with the decorative glyphs. See the guard's
       * own docstring in `candidate.ts`.
       *
       * Named `number` rather than reusing a conventional name: it is not a
       * title, a caption or a body, and calling it one would tell the model
       * to write prose into a box two characters wide.
       */
      number: {
        label: 'Part number',
        description:
          'The part number as digits — "01", "02". Two characters, no words.',
        required: false,
      },
    },
  },
  {
    slide: 5,
    type: 'title-only',
    label: 'Title only',
    purpose: 'A heading alone, for a stretch the lecturer talks through',
    slots: {
      title: {
        label: 'Title',
        description:
          'The heading, in capitals. Nothing else is on the slide, so it has to carry it.',
        required: true,
      },
    },
  },
  {
    slide: 8,
    type: 'content',
    label: 'Content',
    purpose: 'The workhorse: a small title over one paragraph',
    slots: {
      title: {
        label: 'Title',
        description: 'A label for the paragraph, in capitals.',
        required: true,
      },
      body: {
        label: 'Body',
        description: 'The paragraph the slide exists for. One idea.',
        required: true,
      },
    },
  },
  // AUTHORED LAYOUT: the deck has no slide for it. Built in `authoredLayouts`.
  { type: 'content-list', label: '', purpose: '', slots: {} },
  {
    slide: 3,
    type: 'list',
    label: 'Bullet list',
    purpose: 'Points under a heading set hard against them',
    slots: {
      title: {
        label: 'Title',
        description:
          'The heading, ranged right against the points. Two or three words in capitals.',
        required: true,
      },
      bullets: {
        label: 'Points',
        description:
          'The points. Each fits on one line. Parallel, and no full stops.',
        required: true,
      },
    },
  },
  {
    slide: 4,
    type: 'two-column',
    label: 'Two columns',
    purpose: 'Two paragraphs side by side under one title',
    slots: {
      title: {
        label: 'Title',
        description: 'What both columns are about, in capitals.',
        required: true,
      },
      body: {
        label: 'Left column',
        description: 'The first paragraph.',
        required: true,
      },
      'body-2': {
        label: 'Right column',
        description: 'The second paragraph, which follows on from the first.',
        required: false,
      },
    },
  },
  {
    slide: 9,
    type: 'image-heavy',
    label: 'Text and image',
    purpose: 'An explanation beside the photograph it refers to',
    slots: {
      title: {
        label: 'Title',
        description: 'What the picture is of, in capitals.',
        required: true,
      },
      body: {
        label: 'Body',
        description: 'What to notice in the picture, in a few sentences.',
        required: false,
      },
      image: {
        label: 'Image',
        description:
          'The photograph. It fills the right half of the slide, top to bottom.',
        required: true,
      },
    },
  },
  {
    slide: 7,
    type: 'image-list',
    label: 'Three images',
    purpose: 'Three pictures in a row, each with a line of its own',
    slots: {
      title: {
        label: 'Title',
        description: 'What the three have in common, in capitals.',
        required: true,
      },
      image: {
        label: 'Left image',
        description: 'The leftmost picture.',
        required: true,
      },
      'image-2': {
        label: 'Middle image',
        description: 'The middle picture.',
        required: false,
      },
      'image-3': {
        label: 'Right image',
        description: 'The rightmost picture.',
        required: false,
      },
      body: {
        label: 'Left caption',
        description:
          'What the left picture shows. Open with its name in a word or two.',
        required: false,
      },
      'body-2': {
        label: 'Middle caption',
        description: 'What the middle picture shows, in the same shape.',
        required: false,
      },
      'body-3': {
        label: 'Right caption',
        description: 'What the right picture shows, in the same shape.',
        required: false,
      },
    },
  },
  {
    slide: 10,
    type: 'image-full',
    label: 'Full-width image',
    purpose: 'One picture across the slide, named by the caption beneath it',
    slots: {
      // AUTHORED: this slot has no counterpart in the source. NYU's picture
      // placeholder on that page is EMPTY, so the import had nothing to
      // measure and the rectangle below is invented — see the `n === 10`
      // branch. A layout whose main box is authored is worth knowing about
      // before comparing this design to the deck.
      image: {
        label: 'Image',
        description: 'The picture. It runs nearly the full width of the slide.',
        required: true,
      },
      caption: {
        label: 'Caption',
        description: 'What the picture shows, and where it came from.',
        required: false,
      },
    },
  },
  {
    slide: 6,
    type: 'quote',
    label: 'Statement',
    purpose: 'One sentence or quotation, set as large as the slide allows',
    slots: {
      title: {
        label: 'Statement',
        description:
          'The sentence, in capitals across the whole slide. Name the speaker if it is a quotation.',
        required: true,
      },
    },
  },
  {
    slide: 11,
    type: 'quote-image',
    label: 'Quotation over an image',
    purpose: 'A quotation set white and centred over a photograph',
    slots: {
      title: {
        label: 'Quotation',
        description:
          'The quotation, centred in capitals over the photograph. Name who said it.',
        required: true,
      },
    },
  },
  {
    slide: 12,
    type: 'big-number',
    label: 'Big number',
    purpose: 'One figure or statistic the slide exists to frame',
    slots: {
      title: {
        label: 'Figure',
        description: 'The figure alone — "100%", "1831". No words.',
        required: true,
        // Seven, where the geometry derives eight.
        //
        // The estimate uses one character width per face, measured on prose
        // at weight 400. This box is Montserrat 700 at 20.83cqi, and the box
        // is 883px against 8 characters needing 883.0 — a budget sitting on
        // its own boundary, where which eight characters decides it.
        // Measured in the browser: eight renders between 1.00 and 0.85
        // depending on the letters, seven renders at 1.00 for every figure
        // anyone would write, capitals included. Stated here rather than
        // fixed in the width table because the weight gap is real but not
        // contained — see docs/TEMPLATES.md §9.
        maxChars: 7,
      },
      caption: {
        label: 'What it measures',
        description: 'What the figure counts, in capitals. A phrase.',
        required: false,
      },
      body: {
        label: 'Body',
        description: 'Why the figure matters, in a sentence or two.',
        required: false,
      },
    },
  },
  // AUTHORED LAYOUTS: the deck has no slide for either. Built below.
  { type: 'code', label: '', purpose: '', slots: {} },
  { type: 'formula', label: '', purpose: '', slots: {} },
  {
    // Built from the run with NOTHING SKIPPED. This page is NYU's own
    // "how to use this template" notes, which an import is right to leave
    // out — but its rectangles are the deck's white idiom, so they are kept
    // as a layout and measured by the importer rather than typed.
    slide: 13,
    type: 'closing',
    label: 'Closing',
    purpose: 'The last slide: what to take away, or where to go next',
    slots: {
      title: {
        label: 'Title',
        description: 'A closing heading, centred and in capitals.',
        required: true,
      },
      caption: {
        label: 'Caption',
        description: 'What to take away, or where to go next.',
        required: true,
      },
    },
  },
]

const main = async () => {
  const {
    toSourcePresentation,
    importSourcePresentation,
    capacityOf,
    NATURAL_LINE_BOX,
  } = await importer()
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<
    string,
    unknown
  >
  const source = toSourcePresentation(raw)
  const run = await importSourcePresentation(source, { keepEverySlide: true })
  const unskipped = await importSourcePresentation(
    { ...source, slides: source.slides.map(s => ({ ...s, skipped: false })) },
    { keepEverySlide: true },
  )
  const pictures = JSON.parse(readFileSync(PICTURES_FILE, 'utf8')) as Record<
    string,
    Record<string, unknown>[]
  >
  const theme = run.template.theme as Record<string, unknown> & {
    textStyles: Record<string, Role>
  }
  const roles = theme.textStyles

  const layoutOf = (r: typeof run, n: number): Layout => {
    const type = r.template.layoutOfSlide[source.slides[n - 1]!.id]
    const found = r.template.layouts.find(l => l.type === type)
    if (!found) throw new Error(`no layout derived for slide ${n}`)
    return JSON.parse(JSON.stringify(found)) as Layout
  }
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
  const rewrite = (pieces: Record<string, unknown>[]) =>
    pieces.map(p => {
      if (!p.imageUrl) return { ...p }
      const file = String(p.imageUrl)
      if (!ASSETS[file]) throw new Error(`unmapped asset ${file}`)
      return { ...p, imageUrl: `/templates/nyu-bold/${ASSETS[file]}` }
    })
  /** The pictures, from the run that fetched them — paired by rectangle
   * against the fresh derivation rather than trusted. */
  const decorationFor = (fresh: Layout, n: number) => {
    const original = pictures[String(n)] ?? []
    const same = (a: Piece, b: Piece) =>
      near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h)
    // Anything the fresh derivation draws that the recorded run did not is
    // something the reader has since learned to read — the deck's violet
    // rules, which are `line` elements Google does not send as shapes. They
    // paint last, over the page and under nothing.
    const added = (fresh.decoration ?? []).filter(
      piece => !original.some(o => same(o, piece)),
    )
    for (const piece of added)
      if (!piece.fill)
        throw new Error(
          `slide ${n}: a picture the fresh derivation drew is not in the recorded run`,
        )
    return [...rewrite(original), ...(added as Record<string, unknown>[])]
  }

  /** What a box of this role holds, measured by the importer's own
   * instrument — the same call `build-template` makes for a derived box. */
  const budgetOf = (box: Box, role: string, kind: 'text' | 'bullets') =>
    capacityOf(
      { name: 'x', kind, box, fontSize: roles[role].fontSize } as CandidateSlot,
      {
        caps: roles[role].caps,
        fontFamily: roles[role].fontFamily,
        lineHeight: roles[role].lineHeight,
      },
    )

  /** Set on the `eq` box; measured against the title, not chosen. */
  const EQ_SIZE = 8.33

  /** The white page furniture — the band, the grid mark and the logo — taken
   * from the `content` page, which is the deck's plainest white slide. */
  const WHITE_FURNITURE = () => rewrite(pictures['8'] ?? [])

  const TITLE_BOX = { x: 0.034, y: 0.087, w: 0.921, h: 0.155 }
  const authoredLayouts = (): Record<string, Layout> => {
    const titleBudget = budgetOf(TITLE_BOX as Box, 'title', 'text')
    const clBody = { x: 0.034, y: 0.28, w: 0.921, h: 0.14 }
    const clBullets = { x: 0.034, y: 0.46, w: 0.921, h: 0.37 }
    const fCaption = { x: 0.034, y: 0.7, w: 0.921, h: 0.12 }
    return {
      'content-list': {
        type: 'content-list',
        label: 'Text and points',
        purpose: 'A sentence that sets up the points that follow',
        slots: [
          {
            name: 'title',
            kind: 'text',
            label: 'Title',
            description: 'The heading, in capitals.',
            required: true,
            ...titleBudget,
          },
          {
            name: 'body',
            kind: 'text',
            label: 'Body',
            description: 'One or two sentences of context for the points.',
            multiline: true,
            required: false,
            ...budgetOf(clBody as Box, 'body', 'text'),
          },
          {
            name: 'bullets',
            kind: 'bullets',
            label: 'Points',
            description:
              'What follows from the opening sentence. Parallel, no full stops.',
            multiline: true,
            required: true,
            ...budgetOf(clBullets as Box, 'bullet', 'bullets'),
          },
        ],
        elementPositions: {
          title: {
            ...TITLE_BOX,
            textStyle: 'title',
            align: 'start',
            vAlign: 'start',
          },
          body: {
            ...clBody,
            textStyle: 'body',
            color: '#333333',
            align: 'start',
            vAlign: 'start',
          },
          bullets: {
            ...clBullets,
            textStyle: 'bullet',
            align: 'start',
            vAlign: 'start',
          },
        },
        decoration: WHITE_FURNITURE(),
      },
      code: {
        type: 'code',
        label: 'Code',
        purpose: 'A program listing under a short title',
        slots: [
          {
            name: 'title',
            kind: 'text',
            label: 'Title',
            description: 'What the listing does.',
            required: true,
            ...titleBudget,
          },
          {
            name: 'snippet',
            kind: 'code',
            label: 'Program listing',
            description:
              'The listing itself, exactly as typed. Never a sentence about it.',
            required: true,
          },
        ],
        elementPositions: {
          title: {
            ...TITLE_BOX,
            textStyle: 'title',
            align: 'start',
            vAlign: 'start',
          },
          // No ground of its own. `SlideCode` draws the listing's panel and
          // sizes it to the listing; a surface on the BOX is the full 0.55 of
          // the slide whatever the listing's length, so a six-line snippet sat
          // on a dark panel inside a pale one that ran a fifth further down.
          snippet: { x: 0.034, y: 0.28, w: 0.921, h: 0.55 },
        },
        decoration: WHITE_FURNITURE(),
      },
      formula: {
        type: 'formula',
        label: 'Formula',
        purpose: 'One expression, set large, with a note beneath',
        slots: [
          {
            name: 'title',
            kind: 'text',
            label: 'Title',
            description: 'What the expression describes, in words.',
            required: true,
            ...titleBudget,
          },
          {
            name: 'eq',
            kind: 'math',
            label: 'Equation',
            description: 'The expression in LaTeX, with no surrounding prose.',
            required: true,
          },
          {
            name: 'caption',
            kind: 'text',
            label: 'Caption',
            description: 'Name each symbol, in order.',
            required: false,
            ...budgetOf(fCaption as Box, 'caption', 'text'),
          },
        ],
        elementPositions: {
          title: {
            ...TITLE_BOX,
            textStyle: 'title',
            align: 'start',
            vAlign: 'start',
          },
          // KaTeX sizes itself against its container, so the box's own
          // fontSize is what makes the expression the subject of the slide
          // rather than a line of body copy. Declaring none left it at 17px
          // against a 42px heading — the one thing the slide exists to show,
          // set smaller than half its own title.
          eq: {
            x: 0.034,
            y: 0.3,
            w: 0.921,
            h: 0.36,
            fontSize: EQ_SIZE,
            align: 'center',
            vAlign: 'center',
          },
          caption: {
            ...fCaption,
            textStyle: 'caption',
            align: 'center',
            vAlign: 'start',
          },
        },
        decoration: WHITE_FURNITURE(),
      },
    }
  }
  const NEW = authoredLayouts()

  const layouts: Layout[] = []
  for (const entry of ROSTER) {
    if (!entry.slide) {
      layouts.push(NEW[entry.type]!)
      continue
    }
    const n = entry.slide
    const fresh = layoutOf(n === 13 ? unskipped : run, n)
    const positions = fresh.elementPositions
    let slots = fresh.slots

    if (n === 1) {
      // AUTHORED. NYU's own title box overlaps its subtitle by 0.7% of the
      // slide's height, and both hold words — which the audit calls a fault,
      // rightly: two boxes of text on top of each other is a defect wherever
      // it came from. The box keeps the height its own text needs and is
      // RAISED so its bottom sits just clear of the caption (0.6058 against
      // 0.6065), which is the right direction for a box whose words sit on
      // its bottom edge. The caption is untouched — its position is measured.
      positions.title!.y = 0.6058 - positions.title!.h
    }
    if (n === 2) {
      // The numeral. `nameUnlabelled` calls it `title-2` because it is the
      // second unlabelled text box on the page; renamed to what it is, so the
      // model is not asked to write a second title into a box two characters
      // wide. See the roster entry.
      slots = slots.map(s =>
        s.name === 'title-2' ? { ...s, name: 'number' } : s,
      )
      if (!positions['title-2'])
        throw new Error(
          'slide 2: the numeral did not arrive as a slot. The ornament ' +
            'guard in candidate.ts drops it when it measures capacity ' +
            'below MIN_CONTENT_CHARS.',
        )
      positions.number = positions['title-2']!
      delete positions['title-2']

      /*
       * AUTHORED. The numeral is nudged 0.02 of the slide's height down —
       * about 11px as it renders — and its box shortened by the same amount
       * so its bottom edge stays on the slide.
       *
       * NYU's own two rectangles overlap: the title box runs to 0.447 and the
       * numeral box begins at 0.323. That is not a defect in the deck — the
       * GLYPHS clear each other by 0.062 of the slide, measured in a browser
       * on the real strings, about a third of the title's own type size. Our
       * overlap rule compares ink rather than rectangles for exactly this
       * reason (`shared/types/text-ink`).
       *
       * But the rule has to hold for what the slots permit, not for the two
       * strings NYU happens to have written, and its own worst case put a
       * `Q` in the title over the dot of an `i` in the numeral with 0.0094 of
       * the slide — about 5px — of genuine ink overlap.
       *
       * WHERE THAT LEAVES THE SHIPPED GEOMETRY, measured at the rectangle
       * below rather than the one it was derived from:
       *
       *   Q over i or j              clears by 5.7px
       *   nothing over a solidus     clears by 1.9px
       *   Q over a solidus           COLLIDES by 12.7px
       *   @ over a solidus           COLLIDES by 16.7px
       *
       * So every case in letters and digits is now inside the margin, and the
       * one surviving assumption about this pair is that the number box holds
       * DIGITS — no `/`, `\` or `$`, which reach higher than any letter.
       * That is exactly what TMPL-16 would declare, and declaring it is what
       * closes this rather than moving the box further.
       *
       * The size is derived rather than picked: the 0.0094 the rule reports,
       * plus 0.008 for the largest disagreement between the analytic model
       * and the browser measurement that validated it. Rounded up to 0.02.
       * vAlign is `start`, so moving `y` moves the glyphs by the same amount
       * and nothing else about the slide changes.
       */
      const NUDGE = 0.02
      positions.number.y += NUDGE
      positions.number.h -= NUDGE
    }
    if (n === 12) {
      /*
       * AUTHORED. NYU's figure box is shorter than one line box of its own
       * type — 21.2cqi of box for type whose line box is 24.9cqi — because
       * Google lets display type spill out of its box and we clip it. At the
       * declared budget of five characters, before anything wraps, the box
       * cuts 18px of the figure and its ink reaches into the caption whose
       * rectangle it never touches.
       *
       * The growth step cannot fix it: the caption begins at the exact pixel
       * the figure ends. So the figure is given the height its own type
       * needs and everything below it moves down by the same amount, keeping
       * the gaps the design has between them.
       */
      const role = roles.title
      const needed =
        ((NATURAL_LINE_BOX > role.lineHeight
          ? NATURAL_LINE_BOX
          : role.lineHeight) *
          positions.title!.fontSize! +
          1) /
        56.25
      if (!Number.isFinite(needed))
        throw new Error('big-number: the line box could not be computed')
      const shift = needed - positions.title!.h
      if (shift > 0) {
        positions.title!.h = needed
        for (const name of ['caption', 'body'])
          if (positions[name]) positions[name]!.y += shift
      }
    }
    if (n === 3) {
      slots = slots.map(s =>
        s.name === 'body' ? { ...s, name: 'bullets' } : s,
      )
      positions.bullets = positions.body!
      delete positions.body
    }
    if (n === 7) {
      const [left, middle, right] = [
        positions['image-3']!,
        positions.image!,
        positions['image-2']!,
      ]
      positions.image = left
      positions['image-2'] = middle
      positions['image-3'] = right
    }
    if (n === 10) {
      // AUTHORED. The source slide's picture placeholder is EMPTY, so the
      // import had nothing to derive: this rectangle is invented, not
      // measured. It is the only main box in the design that is.
      slots = slots
        .map(s => (s.name === 'title' ? { ...s, name: 'caption' } : s))
        .concat([{ name: 'image', kind: 'image' }])
      positions.caption = positions.title!
      delete positions.title
      positions.image = { x: 0.034, y: 0.06, w: 0.932, h: 0.6 }
    }
    if (n === 13) {
      slots = slots.map(s =>
        s.name === 'body' ? { ...s, name: 'caption' } : s,
      )
      positions.caption = positions.body!
      delete positions.body
      // `sectionTitle` is a role of the OTHER run — the deck has one box at
      // that size once its instructions page is left out, and one box is not
      // a scale. Resolved to what that role meant, so the box still draws as
      // NYU set it and the file names no role it does not define.
      const role = (
        unskipped.template.theme as unknown as {
          textStyles: Record<string, Role>
        }
      ).textStyles.sectionTitle!
      const box = positions.title!
      delete box.textStyle
      Object.assign(box, {
        fontSize: role.fontSize,
        fontWeight: role.fontWeight,
        caps: role.caps,
        fontFamily: role.fontFamily,
        lineHeight: role.lineHeight,
        color: role.color,
      })
    }

    const authored = entry.slots
    const written = slots.map(slot => {
      const over = authored[slot.name]
      if (!over)
        throw new Error(`${entry.type}: nothing written for ${slot.name}`)
      return {
        name: slot.name,
        kind: slot.kind,
        label: over.label,
        description: over.description,
        ...(slot.multiline ? { multiline: true } : {}),
        // An authored budget overrides the derived one. Used once, and the
        // reason is written where it is set.
        ...(over.maxChars
          ? { maxChars: over.maxChars }
          : slot.maxChars
            ? { maxChars: slot.maxChars }
            : {}),
        ...(slot.maxItems ? { maxItems: slot.maxItems } : {}),
        ...(over.required === undefined ? {} : { required: over.required }),
      }
    })
    const order = Object.keys(authored)
    written.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
    // Every title box in the design is violet, and the `title` role now says
    // so — a box restating it would be the only thing in the file that could
    // fall out of step with the palette.
    for (const box of Object.values(positions))
      if (box.textStyle === 'title' && box.color === roles.title?.color)
        delete box.color

    const decoration = decorationFor(fresh, n)
    if (n === 9)
      for (const piece of decoration)
        // AUTHORED. The vertical seam rule is derived at 0.4958–0.5042,
        // straddling the picture's edge exactly as NYU draws it. Decoration
        // paints beneath every slot here, so half of it would be behind the
        // photograph. Moved to abut — 3px at 1000px wide, and the whole rule
        // visible. A compensation for a renderer limitation, not a reading
        // of the source.
        if (!piece.imageUrl && piece.h > 0.9 && piece.w < 0.05)
          piece.x = 0.5 - piece.w
    layouts.push({
      type: entry.type,
      label: entry.label,
      purpose: entry.purpose,
      slots: written,
      elementPositions: positions,
      decoration,
    })
  }
  // AUTHORED LAYOUT: the deck has no slide for it, and it holds nothing to
  // derive — a blank slate the lecturer draws on.
  layouts.push({
    type: 'whiteboard',
    label: 'Whiteboard',
    purpose: 'A blank slate for freehand drawing',
    slots: [],
    elementPositions: {},
  })

  const template = {
    id: 'nyu-bold',
    name: 'NYU Bold',
    renderMode: 'positioned',
    aiInstructions:
      'Audience: NYU students, faculty and staff — educated generalists, not ' +
      'specialists in this subject. This design shouts: titles are set in ' +
      'enormous capitals and every title box is short, so write a title as a ' +
      'label, not a sentence — two or three short words. A long title is ' +
      'cut, not shrunk; put the sentence you wanted to title with in the ' +
      'body beneath. Elsewhere write plain, precise academic English and ' +
      'expand an acronym the first time it appears. One idea per slide, ' +
      'sentence case in body and bullets. No hype, no emoji. Name the ' +
      'source of any quotation or statistic.',
    theme: {
      background: theme.background,
      surface: '#f3f3f3',
      text: theme.text,
      muted: '#6f6f6f',
      accent: '#57068c',
      imageBackground: '#f3f3f3',
      link: '#57068c',
      penColor: '#57068c',
      highlighterColor: theme.highlighterColor,
      marginX: 0.034,
      marginY: 0.083,
      gap: 0.03,
      textStyles: {
        ...roles,
        title: { ...roles.title, color: 'accent' },
      },
    },
    layouts,
  }
  if (template.aiInstructions.length > 600)
    throw new Error(`aiInstructions ${template.aiInstructions.length} > 600`)
  writeFileSync(OUT, JSON.stringify(template, null, 2) + '\n')
  console.log(
    `wrote ${OUT.pathname}: ${layouts.length} layouts, ` +
      `aiInstructions ${template.aiInstructions.length} chars`,
  )
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
