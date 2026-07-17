/**
 * The slot system that identifies a slide's editable components. A
 * template layout names its content slots; each slot's shared
 * descriptor gives its media kind and label; the registry below maps
 * each kind to one editor component. Layouts and SlideView never know
 * how a slot is edited — adding an editable media type later means
 * extending SlotKind, describing the slot in shared, and registering
 * an editor here.
 */
import { useRef, useState, type ComponentType } from 'react'
import { ImagePlus, ImageUp, Info, X } from 'lucide-react'
import ImageAttributionDialog from '../ImageAttributionDialog'
import Tooltip from '../Tooltip'
import {
  SLOT_DESCRIPTORS,
  type LayoutSlot,
  type Slide,
  type SlideEditInput,
  type SlotDescriptor,
  type SlotKind,
  type SlotSpec,
} from '@slide-machine/shared'
import EditableText from '../EditableText'
import SlideMarkdown from '../SlideMarkdown'
import type { ThemeColors } from './theme'

/** Partial content update produced by in-place editing. */
export type SlideContentPatch = Omit<SlideEditInput, 'slideId'>

/** The slide field backing each slot (image edits will target imageRef). */
const SLOT_FIELDS: Partial<Record<LayoutSlot, keyof Slide>> = {
  title: 'title',
  body: 'body',
  bullets: 'bullets',
  caption: 'caption',
  image: 'imageRef',
}

export interface SlotEditorProps {
  slot: LayoutSlot
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
  /** Owner-only: uploads a file to replace/set this slide's image. */
  onReplaceImage?: (file: File) => void
  /** Owner-only: removes this slide's image (may delete or re-layout the slide). */
  onRemoveImage?: () => void
}

const textValue = (slide: Slide, slot: LayoutSlot): string => {
  const field = SLOT_FIELDS[slot]
  const value = field ? slide[field] : undefined
  return typeof value === 'string' ? value : ''
}

/** A text slot: markdown normally, in-place editable for owners. */
function TextSlot({ slot, descriptor, slide, onEdit }: SlotEditorProps) {
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
      // Empty slots (e.g. after a layout switch) stay clickable via a
      // muted call-to-action placeholder
      emptyDisplay={`Add ${descriptor.label.toLowerCase()}`}
      placeholderStyle
      onSave={v => onEdit({ [slot]: v } as SlideContentPatch)}
    />
  )
}

/** The bullet list edits as a whole: one line per bullet. */
function BulletsSlot({ descriptor, slide, onEdit }: SlotEditorProps) {
  const items = slide.bullets ?? []
  const rendered = (bullets: string[]) => (
    <ul className="flex list-disc flex-col gap-[1.5cqi] pl-[4cqi] text-left text-[2.75cqi]">
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
      emptyDisplay={`Add ${descriptor.label.toLowerCase()}`}
      placeholderStyle
      onSave={v => onEdit({ bullets: v.split('\n').filter(b => b.trim()) })}
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
  slide,
  colors,
  imagePending,
  onEdit,
  onReplaceImage,
  onRemoveImage,
}: SlotEditorProps) {
  const [loadFailed, setLoadFailed] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [attrOpen, setAttrOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const editable = Boolean(onReplaceImage && onRemoveImage)
  const hasImage = Boolean(slide.imageRef) && !loadFailed

  const attribution = slide.attribution
  const hasAttribution = Boolean(
    attribution?.sourceUrl || attribution?.author || attribution?.license,
  )
  // AI-sourced images (web fetch or generated) carry credit the AI wrote,
  // so it is shown but not editable; the instructor's own images (seeded
  // or uploaded) stay editable (IMG-5).
  const aiSourced =
    slide.imageSource === 'stock' || slide.imageSource === 'generated'
  const canEditAttribution = Boolean(onEdit) && !aiSourced
  // Owners can open the dialog to add/correct their own credit; anyone
  // sees the "i" when there is credit to read (IMG-5)
  const showInfo = hasImage && (canEditAttribution || hasAttribution)

  const image = (
    <img
      src={slide.imageRef}
      alt={slide.caption ?? slide.title ?? 'Slide image'}
      onError={() => setLoadFailed(true)}
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
  const fallback = (
    <div
      aria-hidden
      data-testid="image-fallback"
      className="h-full min-h-[16cqi] w-full rounded-lg"
      style={{ backgroundColor: colors.surface }}
    />
  )
  // The discreet bottom-right "i" indicator and its dialog (IMG-5). The
  // label opens upward so it is not clipped by the slide's rounded frame.
  const infoIcon = showInfo && (
    <div className="absolute right-2 bottom-2">
      <Tooltip label="Image details" side="top">
        <button
          aria-label="Image details"
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
        onEdit?.({ attribution: next })
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
    return imagePending ? skeleton : fallback
  }

  const pickFile = () => inputRef.current?.click()
  const acceptFile = (file?: File | null) => {
    if (file) onReplaceImage!(file)
  }

  return (
    <div
      className="group relative h-full w-full"
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
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Upload image file"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          acceptFile(file)
        }}
      />

      {hasImage ? (
        <>
          {image}
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Tooltip label="Replace image">
              <button
                aria-label="Replace image"
                onClick={pickFile}
                className="rounded-md bg-white/90 p-1.5 text-slate-700 shadow hover:bg-white"
              >
                <ImageUp className="h-4 w-4" aria-hidden />
              </button>
            </Tooltip>
            <Tooltip label="Delete image">
              <button
                aria-label="Remove image"
                onClick={onRemoveImage}
                className="rounded-md bg-white/90 p-1.5 text-slate-700 shadow hover:bg-white hover:text-red-600"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </Tooltip>
          </div>
          {infoIcon}
        </>
      ) : (
        // No image: owners always get an upload affordance, even while
        // enrichment is still pending — waiting for an image that may
        // never arrive must not block adding one by hand. The "generating"
        // hint below keeps the pending state visible.
        <button
          onClick={pickFile}
          aria-label="Add image"
          className="flex h-full min-h-[16cqi] w-full flex-col items-center justify-center gap-1 rounded-lg text-slate-400 hover:text-slate-600"
          style={{ backgroundColor: colors.surface }}
        >
          <ImagePlus className="h-[6cqi] w-[6cqi]" aria-hidden />
          <span className="text-[2.5cqi]">
            {imagePending ? 'Finding an image… or add one' : 'Add image'}
          </span>
        </button>
      )}

      {dragOver && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg border-2 border-dashed border-indigo-400 bg-indigo-500/10"
        />
      )}
      {infoDialog}
    </div>
  )
}

/** One editor component per media kind — the extension point. */
const EDITORS: Record<SlotKind, ComponentType<SlotEditorProps>> = {
  text: TextSlot,
  bullets: BulletsSlot,
  image: ImageSlot,
}

/** Renders the right editor for a named slot; unknown slots render
 * nothing. The template's SlotSpec (when provided) takes precedence
 * over the conventional defaults, so template-declared kinds, labels,
 * and validation flow into the editor. */
export default function SlideSlot(props: Omit<SlotEditorProps, 'descriptor'>) {
  const conventional = SLOT_DESCRIPTORS[props.slot] as
    SlotDescriptor | undefined
  const descriptor: SlotDescriptor | undefined = props.spec
    ? {
        kind: props.spec.kind,
        label: props.spec.label,
        multiline: props.spec.multiline ?? conventional?.multiline,
      }
    : conventional
  const Editor = descriptor && EDITORS[descriptor.kind]
  if (!Editor) return null
  return <Editor {...props} descriptor={descriptor} />
}
