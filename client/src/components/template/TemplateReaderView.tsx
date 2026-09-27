/**
 * A design's own page, for everyone who cannot edit it (TMPL-29).
 *
 * Deciding whether to adopt or duplicate a design should not need edit
 * access to learn how it is meant to be used — so this renders the very
 * same field-carrying components the editor does (`TemplateSettings`,
 * `LayoutInspector`, `SlotInspector`), each inside a `<fieldset disabled>`,
 * rather than a hand-rolled read-out that has to be kept in step with them
 * by hand. Every field the editor shows — the theme, the spacing, every
 * text style, every box setting down to its inherited character budget —
 * appears here by construction: adding a field to an inspector adds it to
 * the reader's view for free, and nothing here can quietly drift out of
 * step with what an author sees.
 *
 * `disabled` on a `<fieldset>` disables every form control it contains,
 * natively — inputs, selects, textareas and buttons alike — so "open up
 * this decoration", "bring forward", paint order, and so on all go inert
 * with no extra work. Only navigation stays live: which layout is on
 * screen and which box is selected, through `LayoutRail` and
 * `LayoutTreeOutline`, each told `readOnly` so their own add/delete/drag
 * controls disappear rather than sitting there disabled and confusing.
 * The canvas is not reused at all — a reader has nothing to drag — so the
 * layout is shown as `TemplatePreview` already draws it for a thumbnail.
 */
import { useState } from 'react'
import type { Template } from '@slide-machine/shared'
import { WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'
import { findNode } from './LayoutCanvas'
import LayoutRail from './LayoutRail'
import LayoutTreeOutline from './LayoutTreeOutline'
import LayoutInspector from './LayoutInspector'
import SlotInspector from './SlotInspector'
import TemplateSettings from './TemplateSettings'
import TemplatePreview from './TemplatePreview'
import { themeTextStyles } from '../slide/theme'
import { usePreviewImages } from './usePreviewImages'

/** Every callback an inspector takes, since a reader writes nothing —
 * `<fieldset disabled>` already keeps a click from reaching any of these,
 * this is only here to satisfy the same prop types the editor passes real
 * handlers into. */
const noop = () => {}
const noopRecord = (_key?: string) => {}

export default function TemplateReaderView({
  template,
}: {
  template: Template
}) {
  const images = usePreviewImages()
  // The named text styles a box's own settings are measured against, so the
  // inspector's inherited-budget placeholder reads this design's own values
  // rather than nothing.
  const textStyles = themeTextStyles(template.theme)
  const firstShown = template.layouts.findIndex(
    l => l.type !== WHITEBOARD_LAYOUT_TYPE,
  )
  const [layoutIndex, setLayoutIndex] = useState(Math.max(firstShown, 0))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const layout = template.layouts[layoutIndex]

  // Switching layouts drops whatever box was selected in the one before it —
  // it belongs to that layout, and would otherwise point at a node the
  // layout now on screen may not even have.
  const selectLayout = (index: number) => {
    setLayoutIndex(index)
    setSelectedId(null)
  }

  // The same derivation `TemplateEditor` makes for `SlotInspector`'s props.
  const selected = layout?.tree
    ? findNode(layout.tree, selectedId ?? '')
    : undefined
  const selectedSpec = selected?.node.slot
    ? layout?.slots.find(s => s.name === selected.node.slot)
    : undefined
  const siblings = selected?.parent?.children ?? []
  const selectedAt = siblings.findIndex(c => c.id === selectedId)

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row">
        <LayoutRail
          layouts={template.layouts}
          selected={layoutIndex}
          onSelect={selectLayout}
          onDelete={noop}
          addable={[]}
          onAddType={noop}
          onAddOwn={noop}
          readOnly
        />

        <div className="min-w-0 flex-1">
          {layout && (
            <TemplatePreview
              template={template}
              layout={layout}
              images={images}
              className="mb-4 max-w-xl overflow-hidden rounded-lg border border-slate-200 p-1"
            />
          )}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
          {layout?.tree && layout.type !== WHITEBOARD_LAYOUT_TYPE && (
            <LayoutTreeOutline
              tree={layout.tree}
              specs={layout.slots}
              selectedId={selectedId}
              onSelect={setSelectedId}
              // Hovering lights the matching box on the canvas in the editor;
              // a reader has no canvas to light, so this is unused here.
              onHover={noop}
              onMove={noop}
              onDropOn={noop}
              onAddChild={noop}
              onDelete={noop}
              readOnly
            />
          )}

          {/* `contents` keeps the fieldset itself out of the flex layout —
              only its children (the inspector's own fields) take part in it,
              exactly as if the fieldset were not there. */}
          <fieldset disabled className="contents">
            {layout &&
              (selected && selectedId ? (
                <SlotInspector
                  node={selected.node}
                  spec={selectedSpec}
                  parent={selected.parent?.container}
                  canMoveEarlier={selectedAt > 0}
                  canMoveLater={
                    selectedAt >= 0 && selectedAt < siblings.length - 1
                  }
                  onNode={noop}
                  onStyle={noop}
                  onSpec={noop}
                  onContentType={noop}
                  onContainer={noop}
                  onReorder={noop}
                  onClose={() => setSelectedId(null)}
                  onRecord={noopRecord}
                  textStyles={textStyles}
                />
              ) : (
                <LayoutInspector
                  layout={layout}
                  onChange={noop}
                  onRecord={noopRecord}
                />
              ))}
          </fieldset>
        </div>
      </div>

      <fieldset disabled className="contents">
        <TemplateSettings
          name={template.name}
          visibility={template.visibility}
          myRole={template.myRole}
          aiInstructions={template.aiInstructions ?? ''}
          theme={template.theme}
          onName={noop}
          onAiInstructions={noop}
          onTheme={noop}
          onRecord={noopRecord}
        />
      </fieldset>
    </section>
  )
}
