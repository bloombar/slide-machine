/**
 * One import, end to end (TMPL-8).
 *
 * The stages each do one thing and know nothing of each other; this is what
 * runs them in order and decides what happens when one of them will not
 * cooperate:
 *
 *   1. **read** the presentation into a provider-neutral shape
 *   2. **describe** each slide as the layout it would be
 *   3. **consolidate** those into the few designs the deck is really built
 *      from, naming them with a model where one is reachable
 *   4. **fetch** the pictures, since Google's URLs expire
 *   5. **assemble** a template, and say what was lost on the way
 *
 * ## Only step 1 can fail the import
 *
 * If the presentation cannot be read there is nothing to import and the
 * instructor gets a clear reason. After that, every stage degrades: a model
 * that is down means layouts named by rule, a picture that will not come means
 * an empty box, an unusual deck means a template with fewer layouts. All of it
 * is counted and reported. An instructor who waited for an import should get
 * something they can work with.
 */
import type { GenerationProvider, SlotSpec } from '@slide-machine/shared'
import { fetchAssets } from './assets'
import {
  buildTemplate,
  importReport,
  type ImportReport,
} from './build-template'
import { candidateOf, type Candidate } from './candidate'
import { importedSlide, type ImportedSlide } from './slide-content'
import {
  consolidateWithSemantics,
  verbatimWithSemantics,
  deriveLayouts,
  observedFrom,
  type Consolidation,
  type DerivedLayout,
  type LayoutSemantics,
} from './consolidate'
import { readPresentationLive } from './read-slides'
import { parseSemantics, toDescriptors, withFallbacks } from './semantics'
import type { SourcePage, SourcePresentation } from './source-presentation'
import type { BuiltTemplate } from './build-template'

export interface ImportResult {
  template: BuiltTemplate
  /** The presentation's content, placed on the layouts the design analysis
   * assigned it (EXP-5). A template-only import simply ignores it. */
  slides: ImportedSlide[]
  report: ImportReport
}

/** Where a template's own files live, so a retention sweep can find them and
 * two imports never collide. */
export const assetPrefix = (ownerId: string, presentationId: string): string =>
  `templates/import/${ownerId}/${presentationId}`

/**
 * Names the layouts, falling back to the rules whenever the model will not.
 *
 * Wrapped rather than called directly because there are three ways this can go
 * wrong — unconfigured, unreachable, or answering nonsense — and all three
 * mean the same thing to the importer: use the rules.
 */
const describeWith =
  (provider: Pick<GenerationProvider, 'describeImportedLayouts'> | undefined) =>
  async (layouts: DerivedLayout[]) => {
    if (!provider || !layouts.length) return withFallbacks(layouts, [])
    try {
      const raw = await provider.describeImportedLayouts(toDescriptors(layouts))
      return withFallbacks(layouts, parseSemantics({ layouts: raw }, layouts))
    } catch {
      // An import must not depend on a model being reachable.
      return withFallbacks(layouts, [])
    }
  }

/**
 * A layout the presentation itself defines, with the slides built on it.
 *
 * The spec's first source: a deck that DEFINES layouts has already done the
 * work consolidation exists to do, and its author's own layout is better
 * evidence than any median of the slides wearing it — it is the design, where
 * a slide is one use of it.
 */
interface AuthoredLayout {
  /** The layout page itself, read as a candidate: authoritative boxes and
   * names, taken from the design rather than inferred from its uses. */
  design: Candidate
  /** The slides built on it, which is what the report and the lecture
   * importer count (EXP-5). */
  slides: Candidate[]
}

/**
 * The layouts a presentation genuinely defines, or nothing.
 *
 * Nothing unless it defines more than one AND its slides actually use them:
 * Google hands every deck a `layouts` array, and a hand-built deck's slides
 * all sit on one or two defaults. Treating that as authored would give a
 * single layout for the whole deck, which is worse than clustering.
 */
const authoredLayouts = (
  source: SourcePresentation,
  candidates: Candidate[],
  declarationsFor: (page: SourcePage) => SlotSpec[] | undefined,
): AuthoredLayout[] | undefined => {
  if (source.layouts.length < 2) return undefined

  const usedBy = new Map<string, Candidate[]>()
  source.slides.forEach((slide, i) => {
    const id = slide.layoutId
    const candidate = candidates[i]
    if (!id || !candidate) return
    usedBy.set(id, [...(usedBy.get(id) ?? []), candidate])
  })
  // Every slide has to end up somewhere; a partial authored grouping would
  // silently drop the rest.
  if ([...usedBy.values()].flat().length !== candidates.length) return undefined

  const authored: AuthoredLayout[] = []
  for (const page of source.layouts) {
    const slides = usedBy.get(page.id)
    if (!slides?.length) continue
    const design = candidateOf(page, declarationsFor(page))
    // A layout page whose boxes we could not read tells us less than the
    // slides do, so the deck falls back to clustering rather than importing
    // a layout with nothing on it.
    if (!design.slots.length) return undefined
    // A layout page is only the design if the slides on it agree with each
    // other about how they look. Google hands every deck a stack of default
    // layout pages, and a hand-built deck's slides sit on two or three of
    // them while looking nothing alike — five slides, five colours, two
    // pages. Grouping by the page then throws four of those colours away and
    // paints the rest the page's own white.
    //
    // Disagreement means the design lives on the slides, not the page, so the
    // deck falls back to clustering, which reads what is actually there.
    const looks = new Set(
      slides.map(s => `${s.background ?? ''}::${s.backgroundImage ?? ''}`),
    )
    if (looks.size > 1) return undefined
    authored.push({ design, slides })
  }
  return authored.length > 1 ? authored : undefined
}

/**
 * Fills in what a layout page does not state.
 *
 * A layout page carries the boxes and the names — the design — but its
 * placeholders are usually empty, so they carry no type size, colour or font.
 * Those live on the slides that use it. Taking geometry from the design and
 * styling from its uses is more faithful than either alone.
 */
const styledFromUses = (authored: AuthoredLayout): Candidate => ({
  ...authored.design,
  slots: authored.design.slots.map(slot => {
    if (slot.fontSize !== undefined) return slot
    const uses = authored.slides
      .map(s => s.slots.find(u => u.name === slot.name))
      .filter((u): u is (typeof authored.slides)[number]['slots'][number] =>
        Boolean(u),
      )
    const sizes = uses
      .map(u => u.fontSize)
      .filter((n): n is number => typeof n === 'number')
    return {
      ...slot,
      ...(sizes.length
        ? {
            fontSize: sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)],
          }
        : {}),
      ...(uses.find(u => u.color)
        ? { color: uses.find(u => u.color)!.color }
        : {}),
      ...(uses.find(u => u.fontFamily)
        ? { fontFamily: uses.find(u => u.fontFamily)!.fontFamily }
        : {}),
      ...(uses.some(u => u.bold) ? { bold: true } : {}),
    }
  }),
})

/**
 * Derives layouts from the ones a presentation defines, naming them the same
 * way clustering's are.
 *
 * Each design comes from its own layout page; its `members` are the slides
 * built on it, because that is what the report counts and what a lecture
 * import needs (EXP-5). Its constraints come from those slides, since a layout
 * page holds no content to measure.
 */
const consolidateAuthored = async (
  authored: AuthoredLayout[],
  describe: (layouts: DerivedLayout[]) => Promise<LayoutSemantics[]>,
): Promise<Consolidation> => {
  const derived = deriveLayouts(authored.map(a => [styledFromUses(a)])).map(
    (layout, i) => ({
      ...layout,
      members: authored[i]!.slides.map(s => s.slideId),
      ...(observedFrom(authored[i]!.slides)
        ? { constraints: observedFrom(authored[i]!.slides) }
        : {}),
    }),
  )

  const semantics = await describe(derived)
  const layouts = derived.map((layout, i) => ({
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
  // Nothing is approximated: every slide sat on a layout its author chose.
  return { layouts, approximated: [], assignment }
}

/**
 * Turns a presentation this system has already read into a template.
 *
 * Split from the reading so the whole pipeline can be tested — and driven from
 * a YAML or PowerPoint reader later — without a network.
 */
export const importSourcePresentation = async (
  source: SourcePresentation,
  options: {
    provider?: Pick<GenerationProvider, 'describeImportedLayouts'>
    assetPrefix?: string
    /**
     * Give every slide a layout of its own, instead of consolidating the deck
     * into the few designs it is really built from (TMPL-8).
     *
     * Off by default, because consolidation is what makes a template usable:
     * a forty-slide deck imported slide-for-slide is forty near-identical
     * layouts in the editor and — worse — forty near-identical options for
     * the AI to choose between on every spoken phrase, described identically,
     * so the choice is arbitrary.
     *
     * On, for the deck where that judgement is wrong: a short deck of
     * genuinely different designs, or one an author wants back exactly as
     * they drew it, to merge and delete themselves.
     */
    keepEverySlide?: boolean
  } = {},
): Promise<ImportResult> => {
  // A presentation this system exported carries each layout's slot
  // declarations on the layout itself (EXP-8), and each slide says which
  // layout it is built on. Pairing the two is what makes the round trip
  // lossless: kinds, instructions and limits come back exactly rather than
  // being guessed from geometry.
  const declaredByLayout = new Map(
    source.layouts
      .filter(layout => layout.slotMetadata)
      .map(layout => [layout.id, layout.slotMetadata as unknown as SlotSpec[]]),
  )
  const declarationsFor = (slide: SourcePage): SlotSpec[] | undefined =>
    (slide.layoutId ? declaredByLayout.get(slide.layoutId) : undefined) ??
    // A slide may carry its own declarations when it was exported without a
    // layout of its own.
    (slide.slotMetadata as unknown as SlotSpec[] | undefined)

  // Slides that say nothing about how the deck looks are left out.
  //
  // A slide built from a layout and then left alone carries placeholders the
  // author never sized, and a shape with no place on the page is not part of
  // a design (see `boxFromChain`). Such a slide can be left with no boxes at
  // all — and a layout with no boxes is rejected by the template schema, so
  // deriving one would produce a template that cannot be saved.
  //
  // But no boxes is not the same as no design. A slide that is a colour and
  // an arrow is a design; dropping it loses a whole page of the deck, which
  // is exactly what went missing from a three-colour import. So the test is
  // whether the slide carries ANYTHING — boxes, decoration, or a background
  // of its own — and `toLayout` gives a box to a design that has none.
  const carriesDesign = (candidate: Candidate): boolean =>
    candidate.slots.length > 0 ||
    candidate.decoration.length > 0 ||
    Boolean(candidate.background) ||
    Boolean(candidate.backgroundImage)

  const candidates = source.slides
    .map(slide => candidateOf(slide, declarationsFor(slide)))
    .filter(carriesDesign)

  // A presentation this system exported round-trips losslessly, and the spec
  // says so without conditions (TMPL-8; EXP-6 "materially the same template").
  // So the round trip is not something `keepEverySlide` can switch off: an
  // export of a three-layout template must come back as three layouts, not as
  // one per slide.
  const isOwnExport =
    declaredByLayout.size > 0 || source.slides.some(slide => slide.slotMetadata)

  // A presentation that DEFINES layouts has already done the work
  // consolidation exists to do, and its author's own grouping beats any
  // clustering of ours. So slides are grouped by the layout they were built
  // on, and each group's design derived from those slides.
  //
  // Skipped when every slide is to be kept, because the whole point of that is
  // one layout per slide and an authored grouping is a grouping — but only for
  // a deck from elsewhere, which is the deck that option is about.
  const authored =
    options.keepEverySlide && !isOwnExport
      ? undefined
      : authoredLayouts(source, candidates, declarationsFor)

  // `!isOwnExport` again, for the export whose layouts could not be paired up
  // (a one-layout template, say): it falls past `consolidateAuthored`, and
  // going verbatim there would split it slide-for-slide just the same.
  const { layouts, approximated } = authored
    ? await consolidateAuthored(authored, describeWith(options.provider))
    : options.keepEverySlide && !isOwnExport
      ? await verbatimWithSemantics(candidates, describeWith(options.provider))
      : await consolidateWithSemantics(
          candidates,
          describeWith(options.provider),
        )

  // Pictures are fetched after consolidation, so a deck whose slides collapsed
  // into three layouts does not pay to download forty copies of the same logo.
  const urls = source.slides.flatMap(slide => [
    ...slide.elements
      .map(element => element.imageUrl)
      .filter((url): url is string => Boolean(url)),
    // A page filled with a picture is as much a part of the design as one
    // filled with a colour.
    ...(slide.backgroundImage ? [slide.backgroundImage] : []),
  ])
  const { stored, failed } = options.assetPrefix
    ? await fetchAssets(urls, options.assetPrefix)
    : { stored: new Map<string, string>(), failed: 0 }

  const assignment = new Map<string, number>()
  layouts.forEach((layout, index) => {
    for (const id of layout.members) assignment.set(id, index)
  })
  for (const { slideId, layoutIndex } of approximated) {
    assignment.set(slideId, layoutIndex)
  }

  const template = buildTemplate(source, layouts, assignment, stored)

  // The content half (EXP-5). Built here rather than by a second pass over the
  // presentation because everything it needs is already in hand: which layout
  // each slide landed on, what each of its boxes held, and the stored copy of
  // every picture. Re-deriving any of that later would be a second chance to
  // disagree with the design that was just built.
  //
  // Only slides that carried a design are here — one with nothing on it has no
  // layout to be placed on, and `candidates` dropped it for the same reason.
  const notesById = new Map(source.slides.map(slide => [slide.id, slide.notes]))
  const slides = candidates
    .filter(candidate => template.layoutOfSlide[candidate.slideId])
    .map(candidate =>
      importedSlide(
        candidate,
        template.layoutOfSlide[candidate.slideId]!,
        url => stored.get(url),
        // Speaker notes are narration only on a presentation this system
        // exported, which wrote them from narration in the first place
        // (EXP-8). Another deck's notes may be reminders or citations, and
        // narration is read aloud (PLAY-2) — so they are left where they are.
        isOwnExport ? notesById.get(candidate.slideId) : undefined,
      ),
    )

  // Numbered as the deck presents them: "slide 4" is what an author would
  // call it, and the source id is not something they have ever seen.
  const numberOf = new Map(
    source.slides.map((slide, index) => [slide.id, index + 1]),
  )
  const contentDropped = slides
    .filter(slide => slide.dropped.length)
    .map(slide => ({
      slide: numberOf.get(slide.slideId) ?? 0,
      slots: slide.dropped,
    }))

  return {
    template,
    slides,
    report: {
      ...importReport(source, layouts, approximated.length, failed),
      ...(contentDropped.length ? { contentDropped } : {}),
    },
  }
}

/**
 * Reads a presentation from Google and imports it.
 *
 * The only stage that touches the network for the design itself, and the only
 * one whose failure stops the import — `readPresentationLive` throws a
 * `PresentationUnreadableError` saying whether reconnecting would help.
 */
export const importPresentation = async (options: {
  accessToken: string
  presentationId: string
  ownerId: string
  provider?: Pick<GenerationProvider, 'describeImportedLayouts'>
  /** One layout per slide, rather than the few designs the deck is built
   * from (TMPL-8). The author's choice on the import screen. */
  keepEverySlide?: boolean
}): Promise<ImportResult> => {
  const source = await readPresentationLive(
    options.accessToken,
    options.presentationId,
  )
  return importSourcePresentation(source, {
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.keepEverySlide ? { keepEverySlide: true } : {}),
    assetPrefix: assetPrefix(options.ownerId, options.presentationId),
  })
}
