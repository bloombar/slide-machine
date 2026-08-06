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
import { Trash2 } from 'lucide-react'
import type { Layout } from '@slide-machine/shared'
import { WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'

export default function LayoutInspector({
  layout,
  onChange,
  onDelete,
  onRecord,
}: {
  layout: Layout
  onChange: (patch: Partial<Layout>) => void
  onDelete: () => void
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

      {/* The whiteboard is never offered to the AI, so its purpose text has
          nothing to steer, and it holds no content to arrange (TMPL-7). */}
      {isWhiteboard ? (
        <p className="text-xs text-slate-500">{t('template.whiteboardHint')}</p>
      ) : (
        <>
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

          <button
            type="button"
            onClick={onDelete}
            className="mt-2 flex items-center gap-2 self-start rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {t('template.removeLayoutButton')}
          </button>
        </>
      )}
    </div>
  )
}
