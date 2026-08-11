/**
 * Turning many hand-built slides into few layouts (TMPL-8,
 * docs/TEMPLATES.md §7).
 *
 * Real decks are not cleanly templated. The same "title and bullets" slide
 * gets rebuilt by hand a dozen times, each copy a few pixels off the last.
 * Reproducing every variation would give a template of twenty near-duplicate
 * layouts, which is worse than useless — so the derived layout has to end up
 * **tidier than any slide that produced it**.
 *
 * Four deterministic passes here; the fifth, which assigns meaning, needs a
 * model and lives in `semantics.ts`.
 *
 * ## The thresholds are the knob
 *
 * When an instructor says the import got their design wrong, this is what to
 * turn. Raising `MERGE_TOLERANCE` yields fewer, looser layouts; lowering it
 * yields more, tighter ones. The report says which way.
 */
import type { SourceBox } from './source-presentation'
import { compositionKey, type Candidate, type CandidateSlot } from './candidate'

/** How far apart two slides may be and still be one design, as a fraction of
 * the slide edge. Two percent is about a pixel and a half at a typical
 * rendered size — under the hand's own precision when dragging a box. */
export const MERGE_TOLERANCE = 0.02

/** How far apart two edges may be and still be meant as one (pass 4). Tighter
 * than the merge tolerance: this is about tidying a grid, not about deciding
 * two slides are the same. */
export const SNAP_TOLERANCE = 0.015

/** How far apart two type sizes may be and still be one step of the scale,
 * in `cqi`. */
export const SIZE_TOLERANCE = 0.4

/** How far apart two colours may be and still be the same colour, as a
 * distance in RGB, 0–1. Hand-built decks are full of `#1c1917` and `#1c1918`
 * meaning the same thing. */
export const COLOR_TOLERANCE = 0.06

/** How many slides a design must appear on to become a layout of its own. A
 * one-off is mapped to its nearest layout and reported, or a 40-slide deck
 * yields 25 layouts — the failure this whole module exists to prevent. */
export const MIN_CLUSTER_SIZE = 2

/**
 * How far apart two layouts may be and still merge once the model has said
 * they are the same kind of slide (pass 5). Looser than `MERGE_TOLERANCE`,
 * because agreeing on a type is evidence geometry alone did not have — but
 * still a limit, so a type name can never merge two designs that plainly look
 * different.
 */
export const SEMANTIC_MERGE_TOLERANCE = 0.08

/** A design several slides share, with the slides that produced it. */
export interface DerivedLayout {
  slots: CandidateSlot[]
  decoration: Candidate['decoration']
  background?: string
  /** A picture filling the slide behind everything (TMPL-8). */
  backgroundImage?: string
  /** The slides this design came from, in order. */
  members: string[]
  /** What kind of slide this is — `title`, `two-column`, `section`. Assigned
   * in pass 5, absent until then. */
  type?: string
  /** A sentence an author would recognize the layout by. */
  description?: string
}

/** What consolidation did, for the report and for the lecture importer. */
export interface Consolidation {
  layouts: DerivedLayout[]
  /** Slides that matched no design and were mapped to the nearest one. */
  approximated: { slideId: string; layoutIndex: number }[]
  /** Which layout each slide ended on, so a lecture import needs no second
   * guess (EXP-5). */
  assignment: Map<string, number>
}

/** The most common value, ignoring absent ones; ties go to the first seen. */
const mode = <T>(values: (T | undefined)[]): T | undefined => {
  const counts = new Map<T, number>()
  for (const value of values) {
    if (value === undefined) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  let best: { value: T; n: number } | undefined
  for (const [value, n] of counts) {
    if (!best || n > best.n) best = { value, n }
  }
  return best?.value
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * How far apart two slides are.
 *
 * The **maximum** per-slot box distance, not the mean: one badly misplaced
 * box should keep two slides apart, and a mean lets three well-placed ones
 * average it away.
 */
export const distance = (a: Candidate, b: Candidate): number => {
  const boxes = new Map(b.slots.map(s => [s.name, s.box]))
  let worst = 0
  for (const slot of a.slots) {
    const other = boxes.get(slot.name)
    if (!other) return Number.POSITIVE_INFINITY
    worst = Math.max(
      worst,
      Math.abs(slot.box.x - other.x),
      Math.abs(slot.box.y - other.y),
      Math.abs(slot.box.w - other.w),
      Math.abs(slot.box.h - other.h),
    )
  }
  return worst
}

/**
 * Average-linkage agglomerative clustering under a tolerance (pass 2).
 *
 * Tolerance rather than rounding into buckets: two slides differing by a
 * tenth of a percent land in different buckets whenever they straddle a
 * boundary, and a tolerance has no boundaries.
 *
 * Average linkage rather than single: single-linkage **chains**, so a run of
 * slides each just under tolerance from the last merges into one cluster
 * spanning many times it.
 */
const cluster = (candidates: Candidate[], tolerance: number): Candidate[][] => {
  let groups = candidates.map(c => [c])
  for (;;) {
    let best = { a: -1, b: -1, d: Number.POSITIVE_INFINITY }
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const pairs = groups[i]!.flatMap(x =>
          groups[j]!.map(y => distance(x, y)),
        )
        const average = pairs.reduce((s, d) => s + d, 0) / pairs.length
        if (average < best.d) best = { a: i, b: j, d: average }
      }
    }
    if (best.d > tolerance || best.a < 0) return groups
    groups = groups.map((g, i) =>
      i === best.a ? [...g, ...groups[best.b]!] : g,
    )
    groups.splice(best.b, 1)
  }
}

/**
 * The design a cluster shares (pass 3).
 *
 * Each box is the **median** across the slides, not one exemplar's. A medoid
 * picks a real slide and inherits its jitter; the median inherits nobody's and
 * is unmoved by one slide somebody dragged askew.
 */
/**
 * Whether a box is the same picture on every slide of a cluster — a logo, a
 * crest, a footer mark.
 *
 * This is the one place that can tell a logo from a figure, and the difference
 * matters: a logo belongs to the design and must never become a box an author
 * is asked to fill or the AI writes into, while a figure is exactly that. A
 * picture that repeats identically is decoration; one that changes per slide
 * is content. A cluster of one tells us nothing, so it stays content.
 */
const isRepeatedImage = (name: string, members: Candidate[]): boolean => {
  if (members.length < 2) return false
  const urls = members.map(
    m => m.slots.find(s => s.name === name)?.content?.imageUrl,
  )
  return urls.every(url => Boolean(url) && url === urls[0])
}

const medianLayout = (members: Candidate[]): DerivedLayout => {
  const first = members[0]!
  const repeated = first.slots.filter(
    slot => slot.kind === 'image' && isRepeatedImage(slot.name, members),
  )
  const slots = first.slots
    .filter(slot => !repeated.includes(slot))
    .map(slot => {
      const mine = members
        .map(m => m.slots.find(s => s.name === slot.name))
        .filter((s): s is CandidateSlot => Boolean(s))
      const boxes = mine
        .map(s => s.box)
        .filter((b): b is SourceBox => Boolean(b))
      const sizes = mine
        .map(s => s.fontSize)
        .filter((n): n is number => typeof n === 'number')
      return {
        ...slot,
        box: {
          x: median(boxes.map(b => b.x)),
          y: median(boxes.map(b => b.y)),
          w: median(boxes.map(b => b.w)),
          h: median(boxes.map(b => b.h)),
        },
        ...(sizes.length ? { fontSize: median(sizes) } : {}),
        // Styling is the cluster's most common, not the first slide's: an
        // exemplar's own oddity should not become the design's.
        ...(mode(mine.map(s => s.color))
          ? { color: mode(mine.map(s => s.color)) }
          : {}),
        ...(mode(mine.map(s => s.bold)) ? { bold: true } : {}),
        ...(mode(mine.map(s => s.fontFamily))
          ? { fontFamily: mode(mine.map(s => s.fontFamily)) }
          : {}),
        // A declaration is the presentation telling us what this box IS
        // (EXP-8); it survives consolidation untouched.
        ...(mine.find(s => s.restored)
          ? { restored: mine.find(s => s.restored)!.restored }
          : {}),
        // The design carries no content; a slide's own words belong to the
        // slide (EXP-5 maps them back).
        content: undefined,
      }
    })
  return {
    slots,
    // A logo is drawn by the design, not filled in by an author.
    decoration: [
      ...first.decoration,
      ...repeated.map(slot => ({
        box: slot.box,
        imageUrl: slot.content!.imageUrl!,
      })),
    ],
    ...(first.background ? { background: first.background } : {}),
    ...(first.backgroundImage
      ? { backgroundImage: first.backgroundImage }
      : {}),
    members: members.map(m => m.slideId),
  }
}

/** Groups near-equal numbers and returns, for each input, the value it should
 * take: its group's median. The one-dimensional case of the same idea as
 * clustering slides. */
const snapValues = (
  values: number[],
  tolerance: number,
): Map<number, number> => {
  const sorted = [...new Set(values)].sort((a, b) => a - b)
  const groups: number[][] = []
  for (const value of sorted) {
    const last = groups[groups.length - 1]
    if (last && value - last[last.length - 1]! <= tolerance) last.push(value)
    else groups.push([value])
  }
  const out = new Map<number, number>()
  for (const group of groups) {
    const to = median(group)
    for (const value of group) out.set(value, to)
  }
  return out
}

/** Distance between two `#rrggbb`, 0–1. */
const colorDistance = (a: string, b: string): number => {
  const rgb = (hex: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
    if (!m) return null
    const n = parseInt(m[1]!, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const x = rgb(a)
  const y = rgb(b)
  if (!x || !y) return Number.POSITIVE_INFINITY
  return (
    Math.sqrt(x.reduce((sum, v, i) => sum + (v - y[i]!) ** 2, 0)) /
    (255 * Math.sqrt(3))
  )
}

/**
 * Tidies the whole design at once (pass 4).
 *
 * Medians alone still leave a title at `x=0.0812` in one layout and `0.0798`
 * in another. Across every derived layout together:
 *
 *   - **edges are aligned**, so "about eight percent" becomes one margin and
 *     the design has a real grid;
 *   - **a recurring box is unified**, so a title that lands in the same place
 *     on most layouts lands in exactly one place on all of them — the most
 *     visible cue that a deck was templated rather than hand-built;
 *   - **the type scale is quantized**, giving a handful of sizes instead of a
 *     continuum;
 *   - **near-identical colours collapse** into the palette.
 */
const standardize = (layouts: DerivedLayout[]): DerivedLayout[] => {
  const lefts = layouts.flatMap(l => l.slots.map(s => s.box.x))
  const rights = layouts.flatMap(l => l.slots.map(s => s.box.x + s.box.w))
  const tops = layouts.flatMap(l => l.slots.map(s => s.box.y))
  const bottoms = layouts.flatMap(l => l.slots.map(s => s.box.y + s.box.h))
  const snapX = snapValues([...lefts, ...rights], SNAP_TOLERANCE)
  const snapY = snapValues([...tops, ...bottoms], SNAP_TOLERANCE)
  const snapSize = snapValues(
    layouts.flatMap(l =>
      l.slots.map(s => s.fontSize).filter((n): n is number => n !== undefined),
    ),
    SIZE_TOLERANCE,
  )

  const palette = [
    ...new Set(
      layouts.flatMap(l =>
        l.slots.map(s => s.color).filter((c): c is string => Boolean(c)),
      ),
    ),
  ]
  // First colour seen wins, and every later near-match becomes it. Order is
  // the order boxes are drawn, so the deck's own most-used colours tend to be
  // the ones kept.
  const canonical: string[] = []
  const collapsed = new Map<string, string>()
  for (const color of palette) {
    const near = canonical.find(c => colorDistance(color, c) <= COLOR_TOLERANCE)
    if (near) collapsed.set(color, near)
    else {
      canonical.push(color)
      collapsed.set(color, color)
    }
  }

  const aligned = layouts.map(layout => ({
    ...layout,
    slots: layout.slots.map(slot => {
      const left = snapX.get(slot.box.x) ?? slot.box.x
      const right =
        snapX.get(slot.box.x + slot.box.w) ?? slot.box.x + slot.box.w
      const top = snapY.get(slot.box.y) ?? slot.box.y
      const bottom =
        snapY.get(slot.box.y + slot.box.h) ?? slot.box.y + slot.box.h
      return {
        ...slot,
        box: {
          x: left,
          y: top,
          w: Math.max(0.01, right - left),
          h: Math.max(0.01, bottom - top),
        },
        ...(slot.fontSize !== undefined
          ? { fontSize: snapSize.get(slot.fontSize) ?? slot.fontSize }
          : {}),
        ...(slot.color
          ? { color: collapsed.get(slot.color) ?? slot.color }
          : {}),
      }
    }),
  }))

  // A box that recurs across most layouts and already lands in about the same
  // place is put in exactly the same place.
  const byName = new Map<string, SourceBox[]>()
  for (const layout of aligned) {
    for (const slot of layout.slots) {
      byName.set(slot.name, [...(byName.get(slot.name) ?? []), slot.box])
    }
  }
  const unified = new Map<string, SourceBox>()
  for (const [name, boxes] of byName) {
    if (boxes.length < Math.max(2, Math.ceil(aligned.length / 2))) continue
    const to = {
      x: median(boxes.map(b => b.x)),
      y: median(boxes.map(b => b.y)),
      w: median(boxes.map(b => b.w)),
      h: median(boxes.map(b => b.h)),
    }
    const spread = Math.max(
      ...boxes.map(b =>
        Math.max(
          Math.abs(b.x - to.x),
          Math.abs(b.y - to.y),
          Math.abs(b.w - to.w),
          Math.abs(b.h - to.h),
        ),
      ),
    )
    if (spread <= SNAP_TOLERANCE * 2) unified.set(name, to)
  }

  return aligned.map(layout => ({
    ...layout,
    slots: layout.slots.map(slot => ({
      ...slot,
      box: unified.get(slot.name) ?? slot.box,
    })),
  }))
}

/**
 * Passes 1 and 2: the slides of a deck, grouped into the designs they share.
 *
 * Kept separate from deriving the layouts because pass 5 merges groups and
 * re-runs 3 and 4 over the union — the median of a merged cluster is not the
 * median of two medians.
 */
export const clusterCandidates = (
  candidates: Candidate[],
  tolerance = MERGE_TOLERANCE,
): Candidate[][] => {
  const order = new Map(candidates.map((c, i) => [c.slideId, i]))

  const byComposition = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    // Background joins the composition: a slide on a dark band is a different
    // design from the same boxes on white, and geometry alone cannot see it.
    const key = `${compositionKey(candidate)}::${candidate.background ?? ''}::${
      candidate.backgroundImage ?? ''
    }`
    byComposition.set(key, [...(byComposition.get(key) ?? []), candidate])
  }

  const clusters: Candidate[][] = []
  for (const group of byComposition.values()) {
    clusters.push(...cluster(group, tolerance))
  }
  // Clustering merges in distance order, and compositions are grouped in a
  // map. Neither is an order anyone reading the report would expect, so put
  // slides and layouts back in the order the deck presents them.
  const bySlide = (a: Candidate, b: Candidate) =>
    order.get(a.slideId)! - order.get(b.slideId)!
  for (const group of clusters) group.sort(bySlide)
  clusters.sort((a, b) => order.get(a[0]!.slideId)! - order.get(b[0]!.slideId)!)
  return clusters
}

/** Passes 3 and 4: one design per group, then the whole set tidied together. */
export const deriveLayouts = (groups: Candidate[][]): DerivedLayout[] =>
  standardize(groups.map(medianLayout))

/**
 * What the model is asked to decide, per layout (pass 5).
 *
 * Types only, never geometry: a bad response can then mislabel a layout but
 * never break one.
 */
export interface LayoutSemantics {
  type?: string
  description?: string
  /** A sentence per slot, by slot name. */
  slotDescriptions?: Record<string, string>
}

/**
 * Pass 5: merges layouts the model called the same kind of slide, then re-runs
 * 3 and 4 over the union.
 *
 * Type equality is necessary but never sufficient — the two must also still
 * look alike, within a looser tolerance. Otherwise one over-eager type name
 * could collapse a deck's whole design into a single layout.
 *
 * A model that invents a fresh name for every layout merges nothing here, and
 * the deck is still consolidated: passes 1–4 did that work already and pass 5
 * only ever merges further.
 */
export const semanticMerge = (
  groups: Candidate[][],
  layouts: DerivedLayout[],
  semantics: (LayoutSemantics | undefined)[],
  tolerance = SEMANTIC_MERGE_TOLERANCE,
): Candidate[][] => {
  const parent = groups.map((_, i) => i)
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]!))

  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const type = semantics[i]?.type
      if (!type || type !== semantics[j]?.type) continue
      if (layouts[i]!.background !== layouts[j]!.background) continue
      const near =
        distance(
          { ...groups[i]![0]!, slots: layouts[i]!.slots },
          { ...groups[j]![0]!, slots: layouts[j]!.slots },
        ) <= tolerance
      if (near) parent[find(j)] = find(i)
    }
  }

  const merged = new Map<number, Candidate[]>()
  groups.forEach((group, i) => {
    const root = find(i)
    merged.set(root, [...(merged.get(root) ?? []), ...group])
  })
  return [...merged.values()]
}

/**
 * The designs a deck is actually built from.
 *
 * A slide whose design nothing else shares does not become a layout of its
 * own: it is mapped to the nearest one and named in the report as
 * approximated. That is a judgment call, which is exactly why it is reported.
 */
export const consolidateCandidates = (
  candidates: Candidate[],
  tolerance = MERGE_TOLERANCE,
): Consolidation => {
  const clusters = clusterCandidates(candidates, tolerance)
  const order = new Map(candidates.map((c, i) => [c.slideId, i]))
  return assemble(clusters, keepRecurring(clusters), order)
}

/** The clusters worth being layouts. Nothing recurred in a deck of one-offs,
 * or a very short one — its slides still need somewhere to live, so every
 * cluster becomes a layout rather than none doing. */
const keepRecurring = (clusters: Candidate[][]): Candidate[][] => {
  const kept = clusters.filter(c => c.length >= MIN_CLUSTER_SIZE)
  return kept.length ? kept : clusters
}

/** Derives the layouts and settles where every slide ended up, including the
 * ones no design would have. */
const assemble = (
  clusters: Candidate[][],
  groups: Candidate[][],
  order: Map<string, number>,
  semantics: (LayoutSemantics | undefined)[] = [],
): Consolidation => {
  // Merging in pass 5 concatenates groups, so put members back in deck order:
  // a report that lists slides out of order reads as a bug.
  for (const group of groups) {
    group.sort((a, b) => order.get(a.slideId)! - order.get(b.slideId)!)
  }
  const layouts = deriveLayouts(groups).map((layout, i) => ({
    ...layout,
    ...(semantics[i]?.type ? { type: semantics[i]!.type } : {}),
    ...(semantics[i]?.description
      ? { description: semantics[i]!.description }
      : {}),
    slots: layout.slots.map(slot => {
      const described = semantics[i]?.slotDescriptions?.[slot.name]
      return described ? { ...slot, description: described } : slot
    }),
  }))

  const assignment = new Map<string, number>()
  layouts.forEach((layout, index) => {
    for (const id of layout.members) assignment.set(id, index)
  })

  const placed = new Set(groups.flat().map(c => c.slideId))
  const approximated: Consolidation['approximated'] = []
  for (const orphan of clusters.flat().filter(c => !placed.has(c.slideId))) {
    // The nearest design that will have it, by the same distance the
    // clustering used.
    let best = { index: 0, d: Number.POSITIVE_INFINITY }
    groups.forEach((group, index) => {
      const d = Math.min(...group.map(member => distance(orphan, member)))
      if (d < best.d) best = { index, d }
    })
    assignment.set(orphan.slideId, best.index)
    approximated.push({ slideId: orphan.slideId, layoutIndex: best.index })
  }

  return { layouts, approximated, assignment }
}

/**
 * All five passes, including the one that needs a model.
 *
 * `describe` is given the layouts geometry alone produced and returns one
 * entry per layout. It may fail or return nothing useful — a template still
 * comes out, with the names the rules chose. That is the point of keeping the
 * model to naming: an import never depends on it.
 */
export const consolidateWithSemantics = async (
  candidates: Candidate[],
  describe: (
    layouts: DerivedLayout[],
  ) => Promise<(LayoutSemantics | undefined)[]>,
  tolerance = MERGE_TOLERANCE,
): Promise<Consolidation> => {
  const clusters = clusterCandidates(candidates, tolerance)
  const order = new Map(candidates.map((c, i) => [c.slideId, i]))
  const groups = keepRecurring(clusters)
  const firstPass = deriveLayouts(groups)

  const semantics = await describe(firstPass)
  const merged = semanticMerge(groups, firstPass, semantics)
  if (merged.length === groups.length) {
    return assemble(clusters, groups, order, semantics)
  }

  // Merging changed the grouping, so the types no longer line up with it.
  // Each merged layout keeps the type its members agreed on — which is what
  // merged them.
  const remapped = merged.map(group => {
    const from = groups.findIndex(g => g.includes(group[0]!))
    return semantics[from]
  })
  return assemble(clusters, merged, order, remapped)
}
