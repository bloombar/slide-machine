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
import { candidateOf, compositionKey, type Candidate } from './candidate'
import {
  consolidateWithSemantics,
  deriveLayouts,
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
 * The slides of a presentation, grouped the way its own author grouped them.
 *
 * Returns nothing unless the presentation genuinely defines layouts and its
 * slides genuinely use them — Google gives every deck a `layouts` array, and a
 * hand-built deck's slides all sit on one or two default ones. Grouping by
 * that would produce a single layout for the whole deck, which is worse than
 * clustering. So a grouping is only "authored" when it separates the slides
 * into more than one group, and every group is internally consistent about
 * which boxes it has.
 */
const authoredGrouping = (
  source: SourcePresentation,
  candidates: Candidate[],
): Candidate[][] | undefined => {
  if (source.layouts.length < 2) return undefined

  const byLayout = new Map<string, Candidate[]>()
  source.slides.forEach((slide, i) => {
    const id = slide.layoutId
    const candidate = candidates[i]
    if (!id || !candidate) return
    byLayout.set(id, [...(byLayout.get(id) ?? []), candidate])
  })
  if (byLayout.size < 2) return undefined

  // Slides that Google says share a layout but that hold different boxes are
  // not one design in any sense we can use: a group's slots have to agree
  // before a median of them means anything.
  const groups = [...byLayout.values()].filter(group =>
    group.every(c => compositionKey(c) === compositionKey(group[0]!)),
  )
  if (groups.length < 2) return undefined
  // Every slide has to end up somewhere; a partial authored grouping would
  // silently drop the rest.
  return groups.flat().length === candidates.length ? groups : undefined
}

/** Derives layouts from a grouping the presentation's author already made,
 * naming them the same way clustering's are. */
const consolidateAuthored = async (
  groups: Candidate[][],
  describe: (layouts: DerivedLayout[]) => Promise<LayoutSemantics[]>,
): Promise<Consolidation> => {
  const first = deriveLayouts(groups)
  const semantics = await describe(first)
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

  const candidates = source.slides.map(slide =>
    candidateOf(slide, declarationsFor(slide)),
  )

  // A presentation that DEFINES layouts has already done the work
  // consolidation exists to do, and its author's own grouping beats any
  // clustering of ours. So slides are grouped by the layout they were built
  // on, and each group's design derived from those slides.
  const authored = authoredGrouping(source, candidates)
  const { layouts, approximated } = authored
    ? await consolidateAuthored(authored, describeWith(options.provider))
    : await consolidateWithSemantics(candidates, describeWith(options.provider))

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

  return {
    template: buildTemplate(source, layouts, assignment, stored),
    report: importReport(source, layouts, approximated.length, failed),
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
}): Promise<ImportResult> => {
  const source = await readPresentationLive(
    options.accessToken,
    options.presentationId,
  )
  return importSourcePresentation(source, {
    ...(options.provider ? { provider: options.provider } : {}),
    assetPrefix: assetPrefix(options.ownerId, options.presentationId),
  })
}
