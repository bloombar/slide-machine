/**
 * Maps a parsed remark lecture onto the app's slide model.
 *
 * Every slide becomes a `layoutType` plus a map of slot values, which is
 * exactly what `slide.editContent` accepts. Two rules shape the mapping:
 *
 * - **The layout follows the content.** A slide holding a program listing
 *   gets the `code` layout so the listing lands in a real code slot; one
 *   holding a picture and prose gets `two-column`, and so on. Guessing is
 *   unnecessary — the source already says what it holds.
 * - **Overflow splits, it never truncates.** These are lectures somebody
 *   wrote and will teach from, so content past a layout's budget moves to a
 *   continuation slide rather than being cut off.
 */
import { extractInlineImages, resolveMarkdownUrls } from './assets.mjs'

/** Budgets matching the built-in templates, used when none are supplied. */
export const DEFAULT_BUDGETS = {
  title: { maxTitleChars: 50, maxCaptionChars: 80 },
  section: { maxTitleChars: 50 },
  content: { maxTitleChars: 50, maxBodyChars: 400 },
  list: { maxTitleChars: 50, maxBullets: 6, maxBulletChars: 70 },
  'content-list': {
    maxTitleChars: 50,
    maxBodyChars: 200,
    maxBullets: 4,
    maxBulletChars: 70,
  },
  'image-heavy': { maxCaptionChars: 80 },
  'two-column': { maxTitleChars: 50, maxBodyChars: 250 },
  quote: { maxBodyChars: 200, maxCaptionChars: 60 },
  code: { maxTitleChars: 50 },
}

/**
 * Reads per-layout budgets off a template fetched from the API, so a deck
 * built on a custom template is paginated to that template's real limits.
 */
export const budgetsFromTemplate = template => {
  if (!template?.layouts) return { ...DEFAULT_BUDGETS }
  const budgets = {}
  for (const layout of template.layouts) {
    budgets[layout.type] = { ...(layout.constraints ?? {}) }
  }
  return budgets
}

/** Which layouts a template actually offers, for graceful fallback. */
const layoutSet = template =>
  template?.layouts
    ? new Set(template.layouts.map(l => l.type))
    : new Set(Object.keys(DEFAULT_BUDGETS))

/**
 * Splits a list of items into runs no longer than `size`. A non-positive or
 * missing size means "no limit", which keeps a template that declines to
 * set one from producing a slide per bullet.
 */
const chunk = (items, size) => {
  if (!size || size < 1 || items.length <= size) return [items]
  const out = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

/**
 * Splits prose into runs no longer than `maxChars`, breaking between
 * paragraphs. A single paragraph over budget is left whole — breaking it
 * mid-sentence would read worse than a slide that runs long, and the
 * renderer shrinks text to fit its box.
 */
const paginateProse = (paragraphs, maxChars) => {
  if (!maxChars || maxChars < 1) return [paragraphs.join('\n\n')]
  const pages = []
  let current = []
  let length = 0
  for (const paragraph of paragraphs) {
    const cost = paragraph.length + (current.length ? 2 : 0)
    if (current.length && length + cost > maxChars) {
      pages.push(current.join('\n\n'))
      current = [paragraph]
      length = paragraph.length
    } else {
      current.push(paragraph)
      length += cost
    }
  }
  if (current.length) pages.push(current.join('\n\n'))
  return pages.length ? pages : ['']
}

/** Flattens a nested markdown list into the flat items a bullets slot holds. */
const flattenItems = (items, resolve) =>
  items.map(item => {
    const text = resolveMarkdownUrls(item.text, resolve)
    // Nesting has no representation in a bullets slot, so depth is shown
    // with an en dash rather than silently flattened away.
    return item.depth > 0 ? `${'– '.repeat(1)}${text}` : text
  })

/**
 * Renders a table as bullets.
 *
 * No built-in layout declares a table slot, and the slide renderer does not
 * draw tables inside prose either — so a table becomes one bullet per row,
 * with its header as a leading bold bullet when it has one. The grid is
 * lost; the content is not.
 */
const tableToItems = (block, resolve) => {
  const cell = value => resolveMarkdownUrls(value, resolve)
  const rows = block.rows.map(row => row.map(cell).filter(Boolean).join(' — '))
  const header = block.header?.filter(Boolean).join(' — ')
  return header ? [`**${header}**`, ...rows] : rows
}

/** Pulls a trailing attribution line ("- Someone") off a block quote. */
const splitAttribution = text => {
  const lines = text.split('\n')
  const last = lines[lines.length - 1]?.trim() ?? ''
  const match = /^[-—–]\s*(.+)$/.exec(last)
  if (match && lines.length > 1) {
    return {
      body: lines.slice(0, -1).join('\n').trim(),
      caption: match[1].trim(),
    }
  }
  return { body: text.trim(), caption: undefined }
}

const textSlot = value => ({ kind: 'text', value })
const bulletsSlot = items => ({ kind: 'bullets', items })
const imageSlot = ref => ({ kind: 'image', ref, source: 'seeded' })
const codeSlot = (source, language) => ({ kind: 'code', source, language })

/**
 * Converts one source slide into one or more app slides.
 *
 * Returns `{ layoutType, slots }` objects in presentation order.
 */
export const slideToAppSlides = (slide, ctx) => {
  const { resolve, budgets, layouts, isFirst, continuation } = ctx
  const has = type => layouts.has(type)
  const budget = type => budgets[type] ?? DEFAULT_BUDGETS[type] ?? {}

  const headings = slide.blocks.filter(b => b.type === 'heading')
  const h1 = headings.find(h => h.depth === 1)
  const h2 = headings.find(h => h.depth === 2)
  const content = slide.blocks.filter(b => b.type !== 'heading')
  const title = (h2?.text ?? h1?.text ?? slide.section ?? '').trim()

  const out = []
  let page = 0
  /**
   * Titles a continuation so a split slide reads as one that follows on.
   *
   * The marker is dropped when it would push the title past the layout's
   * budget, or when the author's own heading already says "(continued)" —
   * a repeated title reads better than a truncated or doubled one.
   */
  const titleFor = (type = 'content') => {
    const base = resolveMarkdownUrls(title, resolve)
    if (page++ === 0 || !continuation) return base
    // Any trailing "(continued…)" the author wrote themselves, in whatever
    // words — "(continued again)", "(continued once more)" — already says it.
    if (/\(cont[^)]*\)\s*$/i.test(base)) return base
    const max = budget(type).maxTitleChars
    const marked = base + continuation
    return !max || marked.length <= max ? marked : base
  }

  // The opening slide of a lecture is its cover.
  if (isFirst && title && has('title')) {
    const caption = content.find(b => b.type === 'paragraph')?.text ?? ''
    out.push({
      layoutType: 'title',
      slots: {
        title: textSlot(resolveMarkdownUrls(title, resolve)),
        ...(caption
          ? { caption: textSlot(resolveMarkdownUrls(caption, resolve)) }
          : {}),
      },
    })
    return out
  }

  // A heading with nothing under it is a section divider.
  if (!content.length) {
    if (!title) return out
    return [
      {
        layoutType: has('section') ? 'section' : 'content',
        slots: { title: textSlot(resolveMarkdownUrls(title, resolve)) },
      },
    ]
  }

  /** Emits the accumulated prose/points/pictures as one or more slides. */
  const flush = group => {
    if (!group.length) return

    const quotes = group.filter(b => b.type === 'quote')
    const images = group.filter(b => b.type === 'image')
    const others = group.filter(b => b.type !== 'quote' && b.type !== 'image')

    // A slide that is only a quotation gets the layout made for one.
    if (quotes.length && !others.length && !images.length && has('quote')) {
      for (const quote of quotes) {
        const { body, caption } = splitAttribution(quote.text)
        for (const part of paginateProse(
          body.split(/\n{2,}/),
          budget('quote').maxBodyChars,
        )) {
          out.push({
            layoutType: 'quote',
            slots: {
              body: textSlot(resolveMarkdownUrls(part, resolve)),
              ...(caption
                ? { caption: textSlot(resolveMarkdownUrls(caption, resolve)) }
                : {}),
            },
          })
        }
      }
      return
    }

    // Prose, points and any quotation kept inline as prose.
    const paragraphs = []
    let bullets = []
    for (const block of [...others, ...quotes]) {
      if (block.type === 'paragraph') {
        const { text, images: inline } = extractInlineImages(block.text)
        images.push(...inline)
        if (text) paragraphs.push(resolveMarkdownUrls(text, resolve))
      } else if (block.type === 'quote') {
        paragraphs.push(resolveMarkdownUrls(block.text, resolve))
      } else if (block.type === 'list') {
        bullets = bullets.concat(flattenItems(block.items, resolve))
      } else if (block.type === 'table') {
        bullets = bullets.concat(tableToItems(block, resolve))
      }
    }

    const picture = images.shift()
    const hasProse = paragraphs.length > 0
    const hasBullets = bullets.length > 0

    if (picture && hasProse && !hasBullets && has('two-column')) {
      const pages = paginateProse(paragraphs, budget('two-column').maxBodyChars)
      pages.forEach((body, i) => {
        out.push({
          layoutType: 'two-column',
          slots: {
            title: textSlot(titleFor('two-column')),
            body: textSlot(body),
            ...(i === 0 ? { image: imageSlot(resolve(picture.url)) } : {}),
          },
        })
      })
    } else if (picture && !hasProse && !hasBullets && has('image-heavy')) {
      out.push({
        layoutType: 'image-heavy',
        slots: {
          image: imageSlot(resolve(picture.url)),
          ...(picture.alt
            ? { caption: textSlot(resolveMarkdownUrls(picture.alt, resolve)) }
            : {}),
        },
      })
    } else if (hasProse || hasBullets) {
      if (picture) images.unshift(picture)
      emitTextSlides(paragraphs, bullets)
    }

    // Any picture that did not fit beside prose becomes a slide of its own,
    // so a slide carrying three diagrams keeps all three.
    for (const extra of images) {
      if (!has('image-heavy')) break
      out.push({
        layoutType: 'image-heavy',
        slots: {
          image: imageSlot(resolve(extra.url)),
          ...(extra.alt
            ? { caption: textSlot(resolveMarkdownUrls(extra.alt, resolve)) }
            : {}),
        },
      })
    }
  }

  /** Emits prose and points, paginating each to its layout's budget. */
  const emitTextSlides = (paragraphs, bullets) => {
    const both = paragraphs.length > 0 && bullets.length > 0
    const type = both
      ? has('content-list')
        ? 'content-list'
        : 'content'
      : bullets.length
        ? has('list')
          ? 'list'
          : 'content'
        : 'content'
    const limits = budget(type)

    if (type === 'content-list') {
      const pages = paginateProse(paragraphs, limits.maxBodyChars)
      const groups = chunk(bullets, limits.maxBullets)
      // Prose leads; points follow, continuing over as many slides as they
      // need. The first slide carries both so the pairing is visible.
      const rows = Math.max(pages.length, groups.length)
      for (let i = 0; i < rows; i++) {
        const slots = { title: textSlot(titleFor('content-list')) }
        if (pages[i]) slots.body = textSlot(pages[i])
        if (groups[i]) slots.bullets = bulletsSlot(groups[i])
        out.push({ layoutType: 'content-list', slots })
      }
      return
    }

    if (type === 'list') {
      for (const group of chunk(bullets, limits.maxBullets)) {
        out.push({
          layoutType: 'list',
          slots: {
            title: textSlot(titleFor('list')),
            bullets: bulletsSlot(group),
          },
        })
      }
      return
    }

    // Falling back to a plain content slide, the points come along as a
    // markdown list in the body — a text slot renders one. Keeping only the
    // prose here would drop the author's points on the floor.
    const prose = [
      ...paragraphs,
      ...(bullets.length ? [bullets.map(b => `- ${b}`).join('\n')] : []),
    ]
    for (const body of paginateProse(prose, limits.maxBodyChars)) {
      out.push({
        layoutType: 'content',
        slots: { title: textSlot(titleFor('content')), body: textSlot(body) },
      })
    }
  }

  // Walk the slide, breaking it at each program listing: a listing needs the
  // code layout, and the prose around it needs a layout that holds prose.
  let group = []
  for (const block of content) {
    if (block.type === 'code') {
      flush(group)
      group = []
      if (has('code')) {
        out.push({
          layoutType: 'code',
          slots: {
            title: textSlot(titleFor('code')),
            snippet: codeSlot(block.source, block.language),
          },
        })
      }
      continue
    }
    group.push(block)
  }
  flush(group)

  return out
}

/**
 * Converts a whole parsed lecture into app slides.
 */
export const deckToSlides = (
  deck,
  { resolve, template, continuation = ' (cont.)' } = {},
) => {
  const ctx = {
    resolve: resolve ?? (url => url),
    budgets: budgetsFromTemplate(template),
    layouts: layoutSet(template),
    continuation,
  }
  const slides = []
  deck.slides.forEach((slide, i) => {
    slides.push(...slideToAppSlides(slide, { ...ctx, isFirst: i === 0 }))
  })
  return slides
}
