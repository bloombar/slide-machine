/**
 * The list of a template's layouts, down the left of the editor.
 *
 * A template carries every conventional layout (TMPL-2) plus any the author
 * added, and only one is worked on at a time — so they are tabs rather than
 * an accordion: the preview beside them shows the selected one full size.
 *
 * The whiteboard is left out. Every template has one and it cannot be removed
 * or given boxes (TMPL-7), so listing it would offer a choice that leads to a
 * blank slate and nothing to do there.
 *
 * The list scrolls beside the preview; adding a layout stays below it, where
 * it is always reachable however many layouts a template has.
 */
import { useTranslation } from 'react-i18next'
import type { Layout } from '@slide-machine/shared'
import { WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'

export default function LayoutRail({
  layouts,
  selected,
  onSelect,
  addable,
  onAddType,
  onAddOwn,
}: {
  layouts: Layout[]
  selected: number
  onSelect: (index: number) => void
  /** Conventional types this template does not have yet. */
  addable: string[]
  onAddType: (type: string) => void
  /** Adds a layout of the author's own. It is named for them — one more
   * thing to type before seeing anything is one thing too many, and the name
   * is editable the moment it exists (TMPL-9). */
  onAddOwn: () => void
}) {
  const { t } = useTranslation()

  // Paired with their real index, since the caller addresses layouts by
  // position in the template and the whiteboard is not shown.
  const shown = layouts
    .map((layout, index) => ({ layout, index }))
    .filter(({ layout }) => layout.type !== WHITEBOARD_LAYOUT_TYPE)

  // `self-start`: the column is as tall as its own content. Stretched to
  // match the inspector beside it, "Add layout" would float far below the
  // last layout with nothing in between.
  return (
    <div className="flex shrink-0 flex-col gap-3 lg:w-44 lg:self-start">
      {/* The list carries the tablist's accessible name already; this is the
          same word made visible, so the column says what it is. */}
      <h4 className="hidden text-xs font-medium text-slate-700 lg:block">
        {t('template.layoutsLabel')}
      </h4>
      {/* Narrow screens stack the editor, and a column of tabs above the
          slide would push the preview off the first screenful. A select says
          the same thing in one line. */}
      <label className="flex flex-col gap-1 lg:hidden">
        <span className="text-xs text-slate-600">
          {t('template.layoutsLabel')}
        </span>
        <select
          value={selected}
          onChange={e => onSelect(Number(e.target.value))}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {shown.map(({ layout, index }) => (
            <option key={layout.type} value={index}>
              {layout.label.trim() || layout.type}
            </option>
          ))}
        </select>
      </label>

      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label={t('template.layoutsLabel')}
        className="hidden max-h-80 min-h-0 flex-col gap-1 overflow-y-auto lg:flex"
      >
        {shown.map(({ layout, index }) => (
          <button
            key={layout.type}
            type="button"
            role="tab"
            aria-selected={index === selected}
            onClick={() => onSelect(index)}
            className={`w-full truncate rounded-md px-3 py-2 text-left text-sm ${
              index === selected
                ? 'bg-indigo-50 font-medium text-indigo-700'
                : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            {layout.label.trim() || layout.type}
          </button>
        ))}
      </div>

      {/* Outside the scroller, so adding a layout never scrolls out of reach. */}
      <div className="flex shrink-0 flex-col gap-2 pt-1">
        {addable.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600">
              {t('template.addLayout')}
            </span>
            <select
              value=""
              onChange={e => {
                if (e.target.value) onAddType(e.target.value)
                e.target.value = ''
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">{t('template.addLayoutChoose')}</option>
              {addable.map(type => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={onAddOwn}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {t('template.newLayoutAdd')}
        </button>
      </div>
    </div>
  )
}
