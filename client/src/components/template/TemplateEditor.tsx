/**
 * Editing a template you authored (TMPL-4): its name, its theme colours, and
 * what each layout is called and is for.
 *
 * A layout's `purpose` is not decoration — it is the text the AI reads when
 * choosing a layout per slide (TMPL-6/GEN-6), so editing it changes what the
 * template produces, and it is labelled as such rather than left to be
 * guessed at.
 *
 * Each layout can also be arranged — where its slots sit on the slide. A
 * layout with no arrangement keeps its hand-tuned component, so arranging one
 * is opt-in and reversible (docs/TEMPLATES.md).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import type { Layout, Template } from '@slide-machine/shared'
import { LAYOUT_TYPES, WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'
import TemplatePreview from './TemplatePreview'
import TemplateArrangement from './TemplateArrangement'

/** The theme keys the renderer resolves (slide/theme.ts). Listed so the
 * editor offers exactly what the renderer reads — no more, no fewer. */
const THEME_KEYS = [
  'background',
  'surface',
  'text',
  'muted',
  'accent',
  'penColor',
  'highlighterColor',
] as const

const asColor = (theme: Record<string, unknown>, key: string): string =>
  typeof theme[key] === 'string' ? (theme[key] as string) : '#000000'

export default function TemplateEditor({
  template,
  layoutSources,
  onSave,
  onCancel,
  saving,
  error,
}: {
  template: Template
  /** Templates to lift a layout definition from when one is added. Copying an
   * existing definition keeps slot sets out of code, so a deployment that
   * ships its own layouts is what defines them. */
  layoutSources: Template[]
  onSave: (draft: {
    name: string
    theme: Record<string, unknown>
    layouts: Layout[]
    visibility: Template['visibility']
  }) => void
  onCancel: () => void
  saving?: boolean
  error?: string | null
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(template.name)
  const [theme, setTheme] = useState<Record<string, unknown>>(template.theme)
  const [layouts, setLayouts] = useState<Layout[]>(template.layouts)
  const [visibility, setVisibility] = useState(template.visibility)

  /** Layout types this template does not have yet, and that some template in
   * the library can supply a definition for. */
  const addable = LAYOUT_TYPES.filter(
    type =>
      !layouts.some(l => l.type === type) &&
      layoutSources.some(s => s.layouts.some(l => l.type === type)),
  )

  const addLayout = (type: string) => {
    for (const source of layoutSources) {
      const found = source.layouts.find(l => l.type === type)
      if (found) {
        setLayouts(prev => [...prev, structuredClone(found)])
        return
      }
    }
  }

  const setLayout = (index: number, patch: Partial<Layout>) =>
    setLayouts(prev =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    )

  // The preview reflects the draft, so a colour change is visible before it
  // is saved rather than after.
  const draft: Template = { ...template, name, theme, layouts }

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        onSave({ name, theme, layouts, visibility })
      }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="sm:w-64 sm:shrink-0">
          <TemplatePreview template={draft} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">
              {t('template.nameLabel')}
            </span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={80}
              required
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="flex flex-col gap-1">
            {/* The hint sits outside the label: inside, it would become part
                of the control's accessible name. */}
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-slate-700">
                {t('template.visibilityLabel')}
              </span>
              <select
                value={visibility}
                onChange={e =>
                  setVisibility(e.target.value as Template['visibility'])
                }
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="private">
                  {t('template.visibility.private')}
                </option>
                <option value="unlisted">
                  {t('template.visibility.unlisted')}
                </option>
                <option value="public">
                  {t('template.visibility.public')}
                </option>
              </select>
            </label>
            <p className="text-xs text-slate-500">
              {t(`template.visibilityHint.${visibility}`)}
            </p>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-slate-700">
              {t('template.themeLabel')}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {THEME_KEYS.map(key => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="color"
                    value={asColor(theme, key)}
                    onChange={e =>
                      setTheme(prev => ({ ...prev, [key]: e.target.value }))
                    }
                    aria-label={t(`template.theme.${key}`)}
                    className="h-7 w-10 shrink-0 rounded border border-slate-300"
                  />
                  <span className="min-w-0 truncate text-slate-600">
                    {t(`template.theme.${key}`)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-slate-700">
          {t('template.layoutsLabel')}
        </legend>
        <p className="text-xs text-slate-500">{t('template.layoutsHint')}</p>
        {layouts.map((layout, i) => (
          <div
            key={layout.type}
            className="rounded-md border border-slate-200 p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                {layout.type}
              </p>
              {/* The whiteboard slate is required of every template, so it is
                  the one layout that cannot be taken away (TMPL-7). */}
              {layout.type !== WHITEBOARD_LAYOUT_TYPE && (
                <button
                  type="button"
                  onClick={() =>
                    setLayouts(prev => prev.filter((_, j) => j !== i))
                  }
                  aria-label={t('template.removeLayout', {
                    name: layout.label,
                  })}
                  title={t('template.removeLayout', { name: layout.label })}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs text-slate-600">
                  {t('template.layoutName')}
                </span>
                <input
                  value={layout.label}
                  onChange={e => setLayout(i, { label: e.target.value })}
                  required
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
              {/* The whiteboard layout is never offered to the AI, so its
                  purpose text has nothing to steer (TMPL-7). */}
              {layout.type !== WHITEBOARD_LAYOUT_TYPE && (
                <label className="flex flex-[2] flex-col gap-1">
                  <span className="text-xs text-slate-600">
                    {t('template.layoutPurpose')}
                  </span>
                  <input
                    value={layout.purpose}
                    onChange={e => setLayout(i, { purpose: e.target.value })}
                    required
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
              )}
            </div>
            {layout.type !== WHITEBOARD_LAYOUT_TYPE && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <TemplateArrangement
                  layout={layout}
                  onChange={elementPositions =>
                    setLayout(i, { elementPositions })
                  }
                />
              </div>
            )}
          </div>
        ))}
        {addable.length > 0 && (
          <label className="flex items-center gap-2">
            <span className="text-xs text-slate-600">
              {t('template.addLayout')}
            </span>
            <select
              value=""
              onChange={e => {
                if (e.target.value) addLayout(e.target.value)
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
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  )
}
