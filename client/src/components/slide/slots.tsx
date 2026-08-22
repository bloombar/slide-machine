/**
 * The slot system that identifies a slide's editable components. A
 * template layout names its content slots; each slot's shared
 * descriptor gives its media kind and label; the registry below maps
 * each kind to one editor component. Layouts and SlideView never know
 * how a slot is edited — adding an editable media type later means
 * extending SlotKind, describing the slot in shared, and registering
 * an editor here.
 *
 * A slide's content is a map keyed by the slot names its layout declares
 * (`slide.slots`), so a layout may hold four pictures or three code samples.
 * Reading and writing go through `slotValue`/`patchSlot`, so a slot the
 * author named behaves exactly like a conventional one.
 */
import { useRef, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, ImageUp, Info, X } from 'lucide-react'
import ImageAttributionDialog from '../ImageAttributionDialog'
import ReplaceImageDialog from '../ReplaceImageDialog'
import Tooltip from '../Tooltip'
import {
  SLOT_DESCRIPTORS,
  resizeTrack,
  tableColumnCount,
  tableTracks,
  type ImageSearchCandidate,
  type LayoutSlot,
  type Slide,
  type SlideEditInput,
  type SlotValue,
  type SlotDescriptor,
  type SlotKind,
  type SlotSpec,
} from '@slide-machine/shared'
import EditableText from '../EditableText'
import SlideMarkdown from '../SlideMarkdown'
import SlideCode from './Code'
import SlideMath from './Math'
import SlideTable from './Table'
import TrackHandle from './TrackHandle'
import type { ThemeColors } from './theme'

/** Partial content update produced by in-place editing. */
export type SlideContentPatch = Omit<SlideEditInput, 'slideId'>

/**
 * The default title a freshly-added slide gets (mirrors the server's
 * deck.addSlide default). It is a placeholder, not real context, so it
 * never seeds the replace/add dialog's image search.
 */
const PLACEHOLDER_SLIDE_TITLE = 'New slide'

/** What one slot holds, flattened for the editors below. The slide stores a
 * kind-tagged value; this is the shape every editor here works in. */
interface SlotContent {
  text?: string
  bullets?: string[]
  imageRef?: string
  imageSource?: Slide['imageSource']
  attribution?: Slide['attribution']
}

/** The conventional slots, which the DTO also carries as fields of their own.
 * Reading falls back to those, so a slide from any older reader still shows
 * its content (docs/plans/extensible-templates-plan.md's migration lever). */
const LEGACY_READ: Record<string, (slide: Slide) => SlotContent> = {
  title: s => ({ text: s.title }),
  body: s => ({ text: s.body }),
  caption: s => ({ text: s.caption }),
  bullets: s => ({ bullets: s.bullets }),
  image: s => ({
    imageRef: s.imageRef,
    imageSource: s.imageSource,
    attribution: s.attribution,
  }),
}

/** What a slot holds, read from the slide's slot map. */
export const slotValue = (slide: Slide, slot: string): SlotContent => {
  const value = slide.slots?.[slot]
  if (!value) return LEGACY_READ[slot]?.(slide) ?? {}
  switch (value.kind) {
    case 'text':
    case 'preformatted':
      return { text: value.value }
    case 'bullets':
      return { bullets: value.items }
    case 'image':
      return {
        imageRef: value.ref,
        imageSource: value.source,
        attribution: value.attribution,
      }
    default:
      return {}
  }
}

/**
 * The slot's stored value, untouched.
 *
 * The flattened `SlotContent` above covers the three kinds every layout has
 * always had. A specialized kind (TMPL-9) carries fields of its own — a
 * language, a header row — that flattening would lose, so its editor reads
 * the value as it is stored.
 */
export const rawSlotValue = (
  slide: Slide,
  slot: string,
): SlotValue | undefined => slide.slots?.[slot]

/** An edit to a slot that keeps its own shape (TMPL-9). */
export const patchSlotValue = (
  slot: string,
  value: SlotValue,
): SlideContentPatch => ({ slots: { [slot]: value } })

/** An edit to a slot, addressed to the slot map by name. */
export const patchSlot = (
  slot: string,
  value: SlotContent,
): SlideContentPatch => {
  const slotValue: SlotValue =
    value.bullets !== undefined
      ? { kind: 'bullets', items: value.bullets }
      : value.imageRef !== undefined || value.attribution !== undefined
        ? {
            kind: 'image',
            ...(value.imageRef !== undefined ? { ref: value.imageRef } : {}),
            ...(value.attribution !== undefined
              ? { attribution: value.attribution }
              : {}),
          }
        : { kind: 'text', value: value.text ?? '' }
  return { slots: { [slot]: slotValue } }
}

export interface SlotEditorProps {
  /** A conventional slot name, or one a template author chose (TMPL-4). */
  slot: string
  /** The template's own spec for this slot, when it declares one —
   * kind/label/validation from the template file (WYSIWYG-ready). */
  spec?: SlotSpec
  descriptor: SlotDescriptor
  slide: Slide
  colors: ThemeColors
  /** Present only for owners: saves a partial content update. */
  onEdit?: (patch: SlideContentPatch) => void
  /** True while background enrichment may still deliver an image. */
  imagePending?: boolean
  /** Owner-only: uploads a file into this slot. The slot name is passed on,
   * since a layout may have several image slots (TMPL-4). */
  onReplaceImage?: (file: File, slot: string) => void
  /** Owner-only: applies a web search result to this slot (EDIT-1). */
  onPickImageCandidate?: (candidate: ImageSearchCandidate, slot: string) => void
  /** Owner-only: empties this slot's image. */
  onRemoveImage?: (slot: string) => void
}

const textValue = (slide: Slide, slot: string): string =>
  slotValue(slide, slot).text ?? ''

/** A text slot: markdown normally, in-place editable for owners. */
/**
 * What an empty box invites you to type, in the words a slide editor uses.
 *
 * "Click to add title" over a heading and "Click to add text" everywhere else
 * is the wording of every slide tool an instructor has already used, and an
 * imported deck should not greet them with a different one. The box's own
 * label is not used: a design imported from Google Slides names its boxes
 * whatever its author did, and "Add body-2" is not an invitation.
 */
const addPrompt = (slot: string, t: (key: string) => string): string =>
  slot === 'title' || slot === 'subtitle'
    ? t('slide.addTitle')
    : t('slide.addText')

function TextSlot({ slot, spec, descriptor, slide, onEdit }: SlotEditorProps) {
  const { t } = useTranslation()
  const value = textValue(slide, slot)
  const multiline = descriptor.multiline ?? false
  if (!onEdit) return <SlideMarkdown text={value} inline={!multiline} />
  return (
    <EditableText
      value={value}
      label={descriptor.label}
      multiline={multiline}
      renderValue={v => (
        <SlideMarkdown text={v} inline={!multiline} links={false} />
      )}
      // Empty slots (e.g. after a layout switch) stay clickable: the
      // call-to-action sizes and names the target, and shows itself on
      // hover or a background click rather than to the room (index.css)
      emptyDisplay={addPrompt(slot, t)}
      placeholderStyle
      hint={slotGuidance(spec, t)}
      onSave={v => onEdit(patchSlot(slot, { text: v }))}
    />
  )
}

/** The bullet list edits as a whole: one line per bullet. */
function BulletsSlot({
  slot,
  spec,
  descriptor,
  slide,
  onEdit,
}: SlotEditorProps) {
  const { t } = useTranslation()
  const items = slotValue(slide, slot).bullets ?? []
  const rendered = (bullets: string[]) => (
    /* Size and spacing come from the box, not from here. A type size in
       `cqi` is a fraction of the SLIDE, so it held still while the box shrank
       its type to fit — the text stayed large and the last line stayed
       hidden. The `bullet` text style supplies the same 2.75 by default, so
       nothing about a slide that already fitted changes; the gaps are in `em`
       for the same reason, and now close up with the type. */
    <ul className="flex list-disc flex-col gap-[0.4em] ps-[1.4em] text-start">
      {bullets.map((b, i) => (
        <li key={i}>
          <SlideMarkdown text={b} inline links={!onEdit} />
        </li>
      ))}
    </ul>
  )
  if (!onEdit) return rendered(items)
  return (
    <EditableText
      value={items.join('\n')}
      label={descriptor.label}
      multiline
      renderValue={v => rendered(v.split('\n'))}
      emptyDisplay={t('slide.addText')}
      placeholderStyle
      hint={slotGuidance(spec, t)}
      onSave={v =>
        onEdit(
          patchSlot(slot, { bullets: v.split('\n').filter(b => b.trim()) }),
        )
      }
    />
  )
}

/**
 * Image slot: the picture when enriched, a pulsing skeleton while pending,
 * a quiet static block otherwise. For owners the slot becomes editable —
 * hovering an image reveals Replace and Remove buttons, an empty slot
 * offers Add, and a file can be dropped onto either. Replace uploads a
 * file; Remove hands off to the page, which may delete the slide or drop
 * it to a text layout depending on the layout.
 */
function ImageSlot({
  slot,
  spec,
  slide,
  colors,
  imagePending,
  onEdit,
  onReplaceImage,
  onPickImageCandidate,
  onRemoveImage,
}: SlotEditorProps) {
  const { t } = useTranslation()
  // Track the URL that failed, not a boolean: when the image is replaced
  // the imageRef changes, so a stale failure never suppresses the new
  // picture — it renders live without needing a page reload.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [attrOpen, setAttrOpen] = useState(false)
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const editable = Boolean(onReplaceImage && onRemoveImage)
  const content = slotValue(slide, slot)
  const imageRef = content.imageRef
  const hasImage = Boolean(imageRef) && failedSrc !== imageRef
  // Seed the dialog's web search only from meaningful context: the AI's
  // image keywords, or a real slide title. A fresh slide's placeholder
  // title is not context, so its search starts blank and the user
  // searches freely rather than on a meaningless default.
  const titleSeed =
    slide.title && slide.title !== PLACEHOLDER_SLIDE_TITLE ? slide.title : ''
  // Seed the box with the AI's keyword phrases separated by COMMAS. The
  // search treats each comma-separated phrase as its own query and pools
  // the results (scored across all phrases), so every phrase contributes —
  // unlike a space-join, which the sources would match as one over-specified
  // conjunctive query ("hobby horse hobby horsing competition …") and find
  // nothing. The user can edit the comma-separated list to refine.
  const searchQuery = slide.imageKeywords?.join(', ') || titleSeed

  const attribution = content.attribution
  const hasAttribution = Boolean(
    attribution?.sourceUrl || attribution?.creator || attribution?.license,
  )
  // AI-sourced images (web fetch or generated) carry credit the AI wrote,
  // so it is shown but not editable; the instructor's own images (seeded
  // or uploaded) stay editable (IMG-5).
  const aiSourced =
    content.imageSource === 'stock' || content.imageSource === 'generated'
  const canEditAttribution = Boolean(onEdit) && !aiSourced
  // Owners can open the dialog to add/correct their own credit; anyone
  // sees the "i" when there is credit to read (IMG-5)
  const showInfo = hasImage && (canEditAttribution || hasAttribution)

  const image = (
    <img
      src={imageRef}
      alt={slide.caption ?? slide.title ?? t('slide.image.alt')}
      onError={() => setFailedSrc(imageRef ?? null)}
      className="h-full w-full object-cover transition-opacity duration-500"
    />
  )
  const skeleton = (
    <div
      aria-hidden
      data-testid="image-skeleton"
      className="h-full min-h-[16cqi] w-full animate-pulse rounded-lg"
      style={{ backgroundColor: colors.surface }}
    />
  )
  // The discreet bottom-right "i" indicator and its dialog (IMG-5). The
  // label opens upward so it is not clipped by the slide's rounded frame.
  const infoIcon = showInfo && (
    // z-10 lifts the control above SlideNavZones' click overlay, which
    // otherwise sits on top and would trigger navigation (matches
    // EditableText).
    <div className="absolute end-2 bottom-2 z-10">
      <Tooltip label={t(`image.details`)} side="top" align="end">
        <button
          aria-label={t(`image.details`)}
          onClick={() => setAttrOpen(true)}
          className="rounded-full bg-black/40 p-1 text-white hover:bg-black/60"
        >
          <Info
            className="h-[3cqi] max-h-4 min-h-3 w-[3cqi] max-w-4 min-w-3"
            aria-hidden
          />
        </button>
      </Tooltip>
    </div>
  )
  const infoDialog = attrOpen && (
    <ImageAttributionDialog
      attribution={attribution}
      editable={canEditAttribution}
      onSave={next => {
        onEdit?.(patchSlot(slot, { attribution: next }))
        setAttrOpen(false)
      }}
      onClose={() => setAttrOpen(false)}
    />
  )

  // Read-only viewers: image plus the "i" indicator when credit exists
  if (!editable) {
    if (hasImage)
      return (
        <div className="relative h-full w-full">
          {image}
          {infoIcon}
          {infoDialog}
        </div>
      )
    // Nothing is coming: a reserved block would read as a picture that failed
    // to load. Editors still get the block below, since it is what they drop
    // a new picture onto.
    return imagePending ? skeleton : null
  }

  // A file dropped straight onto the slot uploads without the dialog
  const acceptFile = (file?: File | null) => {
    if (file) onReplaceImage!(file, slot)
  }

  return (
    <div
      // z-10 lifts the whole editable image above SlideNavZones' click
      // overlay. Without it the overlay sits on top and swallows the
      // pointer, so group-hover never fires and the Replace/Delete icons
      // stay hidden except on the last slide (which has no next-slide
      // zone). Elevating makes the editable image behave like other
      // interactive slide content (cf. EditableText).
      className="group relative z-10 h-full w-full"
      onDragOver={e => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        acceptFile(e.dataTransfer.files?.[0])
      }}
    >
      {hasImage ? (
        <>
          {image}
          <div className="absolute top-2 end-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Tooltip label={t(`image.replace`)} align="end">
              <button
                aria-label={t(`image.replace`)}
                onClick={() => setImageDialogOpen(true)}
                className="rounded-md bg-white/90 p-1.5 text-slate-700 shadow hover:bg-white"
              >
                <ImageUp className="h-4 w-4" aria-hidden />
              </button>
            </Tooltip>
            <Tooltip label={t(`image.removeTooltip`)} align="end">
              <button
                aria-label={t(`image.remove`)}
                onClick={() => onRemoveImage!(slot)}
                className="rounded-md bg-white/90 p-1.5 text-slate-700 shadow hover:bg-white hover:text-red-600"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </Tooltip>
          </div>
          {infoIcon}
        </>
      ) : (
        // No image yet: a quiet reserved block with an Add affordance (opening
        // the same dialog as Replace — upload, drop, or web search). There is
        // no Delete here: removing an image keeps the slide's layout and just
        // empties this slot, so an already-empty slot has nothing to remove.
        // While enrichment may still deliver an image the block pulses and
        // carries the image-skeleton test id so the sourcing state stays visible.
        <>
          <div
            aria-hidden
            data-testid={imagePending ? 'image-skeleton' : 'image-fallback'}
            className={`h-full min-h-[16cqi] w-full rounded-lg ${
              imagePending ? 'animate-pulse' : ''
            }`}
            style={{ backgroundColor: colors.surface }}
          />
          <div className="absolute top-2 end-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Tooltip label={t(`image.add`)} align="end">
              <button
                aria-label={t(`image.add`)}
                onClick={() => setImageDialogOpen(true)}
                className="rounded-md bg-white/90 p-1.5 text-slate-700 shadow hover:bg-white"
              >
                <ImagePlus className="h-4 w-4" aria-hidden />
              </button>
            </Tooltip>
          </div>
        </>
      )}

      {dragOver && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg border-2 border-dashed border-indigo-400 bg-indigo-500/10"
        />
      )}
      {infoDialog}
      {imageDialogOpen && onReplaceImage && onPickImageCandidate && (
        <ReplaceImageDialog
          slideId={slide.id}
          title={hasImage ? t('image.replace') : t('image.add')}
          initialQuery={searchQuery}
          guidance={slotGuidance(spec, t)}
          onUpload={file => onReplaceImage(file, slot)}
          onPickCandidate={candidate => onPickImageCandidate(candidate, slot)}
          onClose={() => setImageDialogOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * What the template meant this box for, in one line (EDIT-7/TMPL-10).
 *
 * An instructor typing into "Worked example" should see the instruction the
 * template wrote for it — "a runnable Python snippet, no more than eight
 * lines" — rather than having to guess from the name, and should see how much
 * it holds before running past it. It is guidance, not a rule: the limits are
 * enforced elsewhere, and nothing here refuses an edit.
 */
export const slotGuidance = (
  spec: SlotSpec | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | undefined => {
  if (!spec) return undefined
  const limits = [
    spec.maxWords !== undefined
      ? t('slide.guidance.words', { count: spec.maxWords })
      : undefined,
    spec.maxChars !== undefined
      ? t('slide.guidance.chars', { count: spec.maxChars })
      : undefined,
    spec.maxItems !== undefined
      ? t('slide.guidance.items', { count: spec.maxItems })
      : undefined,
  ].filter(Boolean)
  const parts = [spec.description, limits.join(' · ')].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

/**
 * An empty specialized box, shown as a box.
 *
 * Prose uses an invisible blank-slot placeholder, which is right for it: an
 * audience should not see a hole where a caption would have gone. A formula
 * or a listing is different — nobody stumbles onto one by typing, so its box
 * has to say that it is there and what belongs in it, or an author cannot
 * find it at all.
 *
 * Only for owners; the editors below return before this on the read-only
 * path, so an audience still sees nothing.
 */
function EmptyFrame({
  empty,
  children,
}: {
  empty: boolean
  children: React.ReactNode
}) {
  if (!empty) return <>{children}</>
  return (
    <div className="rounded-[0.6cqi] border border-dashed border-current/40 px-[1cqi] py-[0.8cqi] opacity-70">
      {children}
    </div>
  )
}

/**
 * A program listing: highlighted on the slide, its plain source in the editor
 * (EDIT-7).
 *
 * The language comes from the slot's own options, so a template that declares
 * a Python box gets Python highlighting on every slide built from it without
 * anyone restating it per slide. A slide may still carry its own — an
 * imported one does.
 */
function CodeSlot({ slot, spec, descriptor, slide, onEdit }: SlotEditorProps) {
  const { t } = useTranslation()
  const value = rawSlotValue(slide, slot)
  const stored = value?.kind === 'code' ? value : undefined
  const language =
    stored?.language ??
    (typeof spec?.options?.language === 'string'
      ? spec.options.language
      : undefined)
  const source = stored?.source ?? ''
  const rendered = (text: string) => (
    <SlideCode source={text} language={language} />
  )
  if (!onEdit) return rendered(source)
  return (
    <EmptyFrame empty={!source}>
      <EditableText
        value={source}
        label={descriptor.label}
        multiline
        source
        fill
        renderValue={rendered}
        // Named by what belongs in it, not by what the box is called: a box
        // still labelled "Slide body" that now holds Python should say so.
        emptyDisplay={
          language
            ? t('slide.addKind.codeIn', { language })
            : t('slide.addKind.code')
        }
        hint={slotGuidance(spec, t)}
        onSave={v =>
          onEdit(
            patchSlotValue(slot, {
              kind: 'code',
              source: v,
              ...(language ? { language } : {}),
            }),
          )
        }
      />
    </EmptyFrame>
  )
}

/** A formula: typeset on the slide, LaTeX in the editor (EDIT-7). */
function MathSlot({ slot, spec, descriptor, slide, onEdit }: SlotEditorProps) {
  const { t } = useTranslation()
  const value = rawSlotValue(slide, slot)
  const stored = value?.kind === 'math' ? value : undefined
  const tex = stored?.tex ?? ''
  const display = stored?.display ?? true
  const rendered = (text: string) => <SlideMath tex={text} display={display} />
  if (!onEdit) return rendered(tex)
  return (
    <EmptyFrame empty={!tex}>
      <EditableText
        value={tex}
        label={descriptor.label}
        multiline
        source
        fill
        renderValue={rendered}
        emptyDisplay={t('slide.addKind.math')}
        hint={slotGuidance(spec, t)}
        onSave={v =>
          onEdit(patchSlotValue(slot, { kind: 'math', tex: v, display }))
        }
      />
    </EmptyFrame>
  )
}

/** Text whose spacing is the point: shown and edited exactly as typed. */
function PreformattedSlot({
  slot,
  spec,
  descriptor,
  slide,
  onEdit,
}: SlotEditorProps) {
  const { t } = useTranslation()
  const value = rawSlotValue(slide, slot)
  const text = value?.kind === 'preformatted' ? value.value : ''
  const rendered = (v: string) => (
    <pre className="text-start font-mono text-[2cqi] leading-[1.5] whitespace-pre">
      {v}
    </pre>
  )
  if (!onEdit) return rendered(text)
  return (
    <EmptyFrame empty={!text}>
      <EditableText
        value={text}
        label={descriptor.label}
        multiline
        source
        fill
        renderValue={rendered}
        emptyDisplay={t('slide.addKind.preformatted')}
        hint={slotGuidance(spec, t)}
        onSave={v =>
          onEdit(patchSlotValue(slot, { kind: 'preformatted', value: v }))
        }
      />
    </EmptyFrame>
  )
}

/**
 * A table, edited cell by cell (EDIT-7).
 *
 * Not one text field holding the whole grid: a table is rows and columns, and
 * an author fixing one number should not have to find it inside a block of
 * delimited text and keep the delimiters balanced. Each cell is its own
 * click-to-edit field, and the row and column controls are what a table needs
 * that prose does not.
 */
function TableSlot({ slot, spec, slide, onEdit }: SlotEditorProps) {
  const { t } = useTranslation()
  const guidance = slotGuidance(spec, t)
  const value = rawSlotValue(slide, slot)
  const stored = value?.kind === 'table' ? value : undefined
  const header = stored?.header
  const rows = stored?.rows ?? []
  const width = tableColumnCount(rows, header)
  const colWidths = stored?.colWidths
  const rowHeights = stored?.rowHeights
  // The header is a band of its own, so the boundary under it can be dragged.
  const bands = header?.length ? rows.length + 1 : rows.length
  const tableRef = useRef<HTMLTableElement | null>(null)

  if (!onEdit)
    return (
      <SlideTable
        header={header}
        rows={rows}
        colWidths={colWidths}
        rowHeights={rowHeights}
      />
    )

  const save = (next: {
    header?: string[]
    rows: string[][]
    colWidths?: number[]
    rowHeights?: number[]
  }) =>
    onEdit(
      patchSlotValue(slot, {
        kind: 'table',
        ...(next.header?.length ? { header: next.header } : {}),
        rows: next.rows,
        // Sizes are only written once something has been dragged, so a table
        // nobody has resized stays as small on the wire as it always was.
        ...(next.colWidths?.length ? { colWidths: next.colWidths } : {}),
        ...(next.rowHeights?.length ? { rowHeights: next.rowHeights } : {}),
      }),
    )

  /** Whatever is stored, carried through an edit that is not about sizes. */
  const sizes = { colWidths, rowHeights }

  const resizeColumn = (c: number, by: number) =>
    save({
      header,
      rows,
      ...sizes,
      colWidths: resizeTrack(colWidths, width, c, by),
    })
  const resizeRow = (band: number, by: number) =>
    save({
      header,
      rows,
      ...sizes,
      rowHeights: resizeTrack(rowHeights, bands, band, by),
    })

  /** Every row padded to the table's width, so an edit never has to reason
   * about a short row. */
  const grid = () =>
    rows.map(row => Array.from({ length: width }, (_, i) => row[i] ?? ''))

  const cell = (text: string, label: string, onCell: (v: string) => void) => (
    <EditableText
      value={text}
      label={label}
      // An empty cell shows a visible dash rather than the invisible
      // blank-slot placeholder text uses: a table's empty cells are where
      // an author is about to type, and they have to be findable.
      emptyDisplay="—"
      // The whole cell is the target. Aiming at the two characters already in
      // a cell is not how anyone edits a table.
      fill
      onSave={onCell}
    />
  )

  const setHeaderCell = (i: number, v: string) => {
    const next = Array.from({ length: width }, (_, c) => header?.[c] ?? '')
    next[i] = v
    save({ header: next, rows, ...sizes })
  }
  const setCell = (r: number, c: number, v: string) => {
    const next = grid()
    next[r]![c] = v
    save({ header, rows: next, ...sizes })
  }
  const addRow = () =>
    save({
      header,
      rows: [...rows, Array.from({ length: width }, () => '')],
      ...sizes,
    })
  const addColumn = () =>
    save({
      ...(header ? { header: [...header, ''] } : {}),
      rows: grid().map(row => [...row, '']),
      ...sizes,
    })
  /* A removed track takes its size with it, so the columns either side of a
   * deleted one keep the widths they were given rather than every column
   * being re-proportioned around the gap. */
  const without = (list: number[] | undefined, i: number) =>
    list?.length ? list.filter((_, n) => n !== i) : undefined
  const removeRow = (r: number) =>
    save({
      header,
      rows: rows.filter((_, i) => i !== r),
      colWidths,
      rowHeights: without(rowHeights, header?.length ? r + 1 : r),
    })
  const removeColumn = (c: number) =>
    save({
      ...(header ? { header: header.filter((_, i) => i !== c) } : {}),
      rows: grid().map(row => row.filter((_, i) => i !== c)),
      colWidths: without(colWidths, c),
      rowHeights,
    })

  // A table has to keep a row and a column to still be a table, and an
  // author who wants none of it deletes the slide or empties the cells.
  const canRemoveRow = rows.length > 1
  const canRemoveColumn = width > 1

  /** The small controls that grow and shrink the grid. Muted until the table
   * is hovered or focused, so they are available without being furniture. */
  const control = (label: string, onClick: () => void, sign: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded px-[0.6cqi] leading-none opacity-0 transition-opacity group-hover:opacity-60 group-focus-within:opacity-60 hover:opacity-100 focus:opacity-100"
    >
      {sign}
    </button>
  )

  const cellClass = 'border border-current/25 px-[1cqi] py-[0.6cqi] align-top'

  /** The handle on the boundary after a column, where there is one after it. */
  const columnHandle = (c: number) =>
    c < width - 1 ? (
      <TrackHandle
        orientation="vertical"
        label={t('slide.table.resizeColumn', { n: c + 1 })}
        tableRef={tableRef}
        onResize={by => resizeColumn(c, by)}
      />
    ) : null

  /** The handle on the boundary under a band, counting the header as one. */
  const rowHandle = (band: number) =>
    band < bands - 1 ? (
      <TrackHandle
        orientation="horizontal"
        label={t('slide.table.resizeRow', { n: band + 1 })}
        tableRef={tableRef}
        onResize={by => resizeRow(band, by)}
      />
    ) : null

  return (
    <div className="group w-full">
      <table
        ref={tableRef}
        className="w-full table-fixed border-collapse text-start text-[2cqi]"
      >
        {/* The widths the table is drawn to, so a drag shows its result. */}
        {colWidths?.length ? (
          <colgroup>
            {tableTracks(colWidths, width).map((w, i) => (
              <col key={i} style={{ width: `${w * 100}%` }} />
            ))}
            {/* The gutter is not one of the table's columns; it gets what the
                browser gives it, as it did before there were widths. */}
            <col />
          </colgroup>
        ) : null}
        {/* One narrow gutter per axis, holding that row's or column's
            remove control. In its own cell rather than floating over the
            table, so nothing it offers sits on top of content. */}
        <thead>
          <tr>
            {Array.from({ length: width }, (_, c) => (
              <th
                key={c}
                className="relative p-0 text-center text-[1.5cqi] font-normal"
              >
                {canRemoveColumn &&
                  control(
                    t('slide.table.removeColumn', { n: c + 1 }),
                    () => removeColumn(c),
                    '×',
                  )}
                {columnHandle(c)}
              </th>
            ))}
            <th className="w-[3cqi] p-0" />
          </tr>
          {header?.length ? (
            <tr>
              {Array.from({ length: width }, (_, i) => (
                <th
                  key={i}
                  scope="col"
                  className={`${cellClass} relative text-start font-semibold`}
                >
                  {cell(
                    header[i] ?? '',
                    t('slide.table.header', { n: i + 1 }),
                    v => setHeaderCell(i, v),
                  )}
                  {i === 0 && rowHandle(0)}
                </th>
              ))}
              <th className="p-0" />
            </tr>
          ) : null}
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {Array.from({ length: width }, (_, c) => (
                <td key={c} className={`${cellClass} relative`}>
                  {cell(
                    row[c] ?? '',
                    t('slide.table.cell', { row: r + 1, column: c + 1 }),
                    v => setCell(r, c, v),
                  )}
                  {c === 0 && rowHandle(header?.length ? r + 1 : r)}
                </td>
              ))}
              <td className="p-0 text-center text-[1.5cqi]">
                {canRemoveRow &&
                  control(
                    t('slide.table.removeRow', { n: r + 1 }),
                    () => removeRow(r),
                    '×',
                  )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-[0.8cqi] flex gap-[1cqi] text-[1.5cqi]">
        <button
          type="button"
          onClick={addRow}
          className="rounded border border-current/30 px-[1cqi] py-[0.3cqi] opacity-70 hover:opacity-100"
        >
          {t('slide.table.addRow')}
        </button>
        <button
          type="button"
          onClick={addColumn}
          className="rounded border border-current/30 px-[1cqi] py-[0.3cqi] opacity-70 hover:opacity-100"
        >
          {t('slide.table.addColumn')}
        </button>
      </div>
      {/* A table has no single field to hang a hint on, and its controls are
          already on screen for owners, so the instruction sits beside them. */}
      {guidance && (
        <span className="mt-[0.4cqi] block text-[1.4cqi] leading-snug opacity-60">
          {guidance}
        </span>
      )}
    </div>
  )
}

/** One editor component per media kind — the extension point. */
const EDITORS: Record<SlotKind, ComponentType<SlotEditorProps>> = {
  text: TextSlot,
  bullets: BulletsSlot,
  image: ImageSlot,
  code: CodeSlot,
  math: MathSlot,
  preformatted: PreformattedSlot,
  table: TableSlot,
}

/** Renders the right editor for a named slot; unknown slots render
 * nothing. The template's SlotSpec (when provided) takes precedence
 * over the conventional defaults, so template-declared kinds, labels,
 * and validation flow into the editor. */
export default function SlideSlot(props: Omit<SlotEditorProps, 'descriptor'>) {
  const { t } = useTranslation()
  const conventional = SLOT_DESCRIPTORS[props.slot as LayoutSlot] as
    SlotDescriptor | undefined
  // A label a template author wrote is data and is shown as written
  // (docs/I18N.md) — but the server normalizes a bare-name conventional
  // slot into a spec carrying the English default, and that one is
  // chrome. They are told apart by comparing against the default: a spec
  // label that IS the default was filled in for the author, not chosen by
  // them, so the bundle wins.
  const authored =
    props.spec && props.spec.label !== conventional?.label
      ? props.spec.label
      : undefined
  // A slot the author named has no bundle key, so its own label is shown
  const label =
    authored ??
    (conventional
      ? t(`slot.${props.slot as LayoutSlot}`)
      : (props.spec?.label ?? props.slot))
  const descriptor: SlotDescriptor | undefined = props.spec
    ? {
        kind: props.spec.kind,
        label,
        multiline: props.spec.multiline ?? conventional?.multiline,
      }
    : conventional && { ...conventional, label }
  const Editor = descriptor && EDITORS[descriptor.kind]
  if (!Editor) return null
  // Every slot renders inside a permanent layout-neutral wrapper tagged
  // for the GEN-9 layout transition (lib/layoutFlip): data-flip-slot
  // finds the slots, data-flip-id matches a slot to itself across the
  // layout swap. Image wrappers pass the container's size through (the
  // img fills its parent chain); text wrappers stay inline-block so they
  // never disturb the flow around them.
  const editor = <Editor {...props} descriptor={descriptor} />
  const flipId = `${props.slide.id}:${props.slot}`
  if (descriptor.kind === 'image')
    return (
      <div
        className="h-full w-full"
        data-flip-slot="image"
        data-flip-id={flipId}
      >
        {editor}
      </div>
    )
  return (
    <span
      className="inline-block max-w-full"
      data-flip-slot={props.slot}
      data-flip-id={flipId}
    >
      {editor}
    </span>
  )
}
