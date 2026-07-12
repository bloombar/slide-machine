/**
 * The slot system that identifies a slide's editable components. A
 * template layout names its content slots; each slot's shared
 * descriptor gives its media kind and label; the registry below maps
 * each kind to one editor component. Layouts and SlideView never know
 * how a slot is edited — adding an editable media type later means
 * extending SlotKind, describing the slot in shared, and registering
 * an editor here.
 */
import { useState, type ComponentType } from 'react'
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

/** Reserved image slot: image when enriched, pulsing skeleton while
 * pending, quiet static block otherwise. Read-only until media editing
 * lands — swapping this component is that feature's whole UI seam. */
function ImageSlot({ slide, colors, imagePending }: SlotEditorProps) {
  const [loadFailed, setLoadFailed] = useState(false)

  if (slide.imageRef && !loadFailed) {
    return (
      <img
        src={slide.imageRef}
        alt={slide.caption ?? slide.title ?? 'Slide image'}
        onError={() => setLoadFailed(true)}
        className="h-full w-full object-cover transition-opacity duration-500"
      />
    )
  }
  if (imagePending) {
    return (
      <div
        aria-hidden
        data-testid="image-skeleton"
        className="h-full min-h-[16cqi] w-full animate-pulse rounded-lg"
        style={{ backgroundColor: colors.surface }}
      />
    )
  }
  return (
    <div
      aria-hidden
      data-testid="image-fallback"
      className="h-full min-h-[16cqi] w-full rounded-lg"
      style={{ backgroundColor: colors.surface }}
    />
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
