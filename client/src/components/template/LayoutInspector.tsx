/**
 * What the right-hand column shows when no box is selected: the layout
 * itself.
 *
 * A layout's `purpose` is not decoration — it is the text the AI reads when
 * choosing a layout per slide (TMPL-6/GEN-6), so editing it changes what the
 * template produces, and it is labelled as such rather than left to be
 * guessed at.
 */
import { useTranslation } from 'react-i18next'
import type {
  Layout,
  LayoutDecoration,
  LayoutNode,
} from '@slide-machine/shared'
import { WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'

/**
 * Turns a picture the design paints into a box a slide can fill.
 *
 * An imported design's photography is decoration: shared by every slide on
 * that layout, never editable, never generated into (TMPL-8). That is the
 * right default — a crest or a brand backdrop is the design, and a lecture
 * should not be able to delete it by accident.
 *
 * But it is only a default. A photograph a title treatment is built around is
 * design in one deck and a placeholder in the next, and the instructor is the
 * one who knows which. So a decoration picture can be opened up: it becomes
 * an image slot at exactly the rectangle it already occupied, which the AI
 * can then source into (IMG-6) and an author can fill by hand.
 *
 * Returned as a patch rather than applied, so the editor's undo covers it
 * like any other edit — which is also how it is reversed.
 */
export const openUpDecoration = (
  layout: Layout,
  piece: LayoutDecoration,
): Partial<Layout> => {
  const taken = new Set(layout.slots.map(s => s.name))
  let name = 'image'
  for (let n = 2; taken.has(name); n++) name = `image-${n}`

  const box = { x: piece.x, y: piece.y, w: piece.w, h: piece.h }
  const node: LayoutNode = { id: name, slot: name, free: true, box }
  // Appended, so it paints over the decoration still beneath it rather than
  // under it: declaration order is paint order.
  const tree = layout.tree
    ? { ...layout.tree, children: [...(layout.tree.children ?? []), node] }
    : layout.tree

  return {
    slots: [...layout.slots, { name, kind: 'image', label: 'Image' }],
    elementPositions: { ...(layout.elementPositions ?? {}), [name]: box },
    decoration: (layout.decoration ?? []).filter(d => d !== piece),
    ...(tree ? { tree } : {}),
  }
}

export default function LayoutInspector({
  layout,
  onChange,
  onRecord,
}: {
  layout: Layout
  onChange: (patch: Partial<Layout>) => void
  onRecord: (key?: string) => void
}) {
  const { t } = useTranslation()
  const isWhiteboard = layout.type === WHITEBOARD_LAYOUT_TYPE

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-slate-700">
        {t('template.layoutSettings')}
      </h3>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-600">
          {t('template.layoutName')}
        </span>
        <input
          value={layout.label}
          onFocus={() => onRecord(`layout-label:${layout.type}`)}
          onChange={e => onChange({ label: e.target.value })}
          required
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
      </label>

      {/* Pictures the design paints, each of which an author may open up into
          a box a slide can fill. Only pictures: a band or a rule holds
          nothing, so there is nothing to hand over. */}
      {!isWhiteboard && (layout.decoration ?? []).some(d => d.imageUrl) && (
        <fieldset className="flex flex-col gap-2 border-t border-slate-200 pt-3">
          <legend className="text-xs font-medium text-slate-700">
            {t('template.decorationPictures')}
          </legend>
          <p className="text-xs text-slate-500">
            {t('template.decorationPicturesHint')}
          </p>
          {(layout.decoration ?? []).map((piece, i) =>
            piece.imageUrl ? (
              <div key={i} className="flex items-center gap-2">
                <img
                  src={piece.imageUrl}
                  alt=""
                  className="h-8 w-12 rounded border border-slate-200 object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    onRecord()
                    onChange(openUpDecoration(layout, piece))
                  }}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  {t('template.openUpDecoration')}
                </button>
              </div>
            ) : null,
          )}
        </fieldset>
      )}

      {/* The whiteboard is never offered to the AI, so its purpose text has
          nothing to steer, and it holds no content to arrange (TMPL-7). */}
      {isWhiteboard ? (
        <p className="text-xs text-slate-500">{t('template.whiteboardHint')}</p>
      ) : (
        // Deleting a layout is not here: it is on the layout's own row in the
        // rail, where every layout can be reached rather than only the one
        // being looked at.
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">
            {t('template.layoutPurpose')}
          </span>
          <input
            value={layout.purpose}
            onFocus={() => onRecord(`layout-purpose:${layout.type}`)}
            onChange={e => onChange({ purpose: e.target.value })}
            required
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          <span className="text-xs text-slate-500">
            {t('template.layoutPurposeHint')}
          </span>
        </label>
      )}
    </div>
  )
}
