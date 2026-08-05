/**
 * Editing a template you authored (TMPL-4): its name, its theme colours, and
 * what each layout is called, is for, and holds.
 *
 * A layout's `purpose` is not decoration — it is the text the AI reads when
 * choosing a layout per slide (TMPL-6/GEN-6), so editing it changes what the
 * template produces, and it is labelled as such rather than left to be
 * guessed at.
 *
 * A layout's boxes are the author's own: they can add one for a heading, a
 * paragraph, or a picture, so a layout with four pictures is something an
 * instructor makes rather than something the app has to ship. Each layout can
 * then be arranged — where those boxes sit on the slide. A layout with no
 * arrangement keeps its hand-tuned component, so arranging one is opt-in and
 * reversible (docs/TEMPLATES.md).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Trash2 } from 'lucide-react'
import type {
  Layout,
  SlotKind,
  SlotSpec,
  Template,
  TemplateRenderMode,
} from '@slide-machine/shared'
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

/** A template that arranges anything is drawn from its boxes; one that
 * arranges nothing keeps the hand-tuned components. Derived on save rather
 * than asked about, since arranging a layout *is* the choice. */
const renderModeOf = (layouts: Layout[]): TemplateRenderMode =>
  layouts.some(l => Object.keys(l.elementPositions ?? {}).length > 0)
    ? 'positioned'
    : 'components'

/** The kinds of content a box can hold. Listed from the shared union rather
 * than written out, so a new media kind reaches this editor for free. */
const SLOT_KINDS: SlotKind[] = ['text', 'bullets', 'image']

/**
 * A machine name for a box the author just added. Slide content is stored
 * under this name, so it must be stable and unique within the layout — the
 * label stays theirs to edit, this does not change once set.
 */
const slotNameFrom = (label: string, taken: string[]): string => {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const stem = base || 'box'
  if (!taken.includes(stem)) return stem
  let n = 2
  while (taken.includes(`${stem}-${n}`)) n++
  return `${stem}-${n}`
}

/**
 * A layout of the author's own starts with one text box, since a layout with
 * no boxes holds nothing and cannot be saved. They rename it, change what it
 * holds, or add more from there.
 */
const newLayout = (label: string, taken: string[]): Layout => ({
  type: slotNameFrom(label, taken),
  label: label.trim(),
  // Their own words, which the AI reads when choosing a layout (TMPL-6).
  purpose: label.trim(),
  slots: [{ name: 'title', kind: 'text', label: 'Slide title' }],
  elementPositions: {},
})

/** Where a newly added box starts on an already-arranged layout: in the
 * middle, big enough to see and grab, so the author drags it where they want
 * rather than hunting for it. */
const NEW_BOX = { x: 0.35, y: 0.35, w: 0.3, h: 0.3 }

/**
 * The boxes one layout holds, and the form that adds another (TMPL-4). This is
 * what makes a template the author's own rather than a recolour of a shipped
 * one: four picture boxes on a slide is four boxes added here.
 *
 * A box's *name* is fixed once added — slide content is stored under it — so
 * only its label and what goes in it can be changed afterwards.
 */
function LayoutSlots({
  layout,
  onAdd,
  onRename,
  onRekind,
  onRemove,
}: {
  layout: Layout
  onAdd: (label: string, kind: SlotKind) => void
  onRename: (slotName: string, label: string) => void
  onRekind: (slotName: string, kind: SlotKind) => void
  onRemove: (slotName: string) => void
}) {
  const { t } = useTranslation()
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<SlotKind>('text')

  const add = () => {
    if (!label.trim()) return
    onAdd(label, kind)
    setLabel('')
    setKind('text')
  }

  return (
    <fieldset className="mb-3 flex flex-col gap-2">
      <legend className="text-xs font-medium text-slate-700">
        {t('template.slotsLabel')}
      </legend>
      <p className="text-xs text-slate-500">{t('template.slotsHint')}</p>

      {layout.slots.map(slot => (
        <div key={slot.name} className="flex items-center gap-2">
          <input
            value={slot.label}
            onChange={e => onRename(slot.name, e.target.value)}
            aria-label={t('template.slotLabel')}
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          <select
            value={slot.kind}
            onChange={e => onRekind(slot.name, e.target.value as SlotKind)}
            aria-label={t('template.slotKind')}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {SLOT_KINDS.map(k => (
              <option key={k} value={k}>
                {t(`template.slotKinds.${k}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onRemove(slot.name)}
            aria-label={t('template.removeSlot', { name: slot.label })}
            title={t('template.removeSlot', { name: slot.label })}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          // Enter would submit the whole template, which is not what typing a
          // box name means
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder={t('template.addSlotName')}
          aria-label={t('template.addSlotName')}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <select
          value={kind}
          onChange={e => setKind(e.target.value as SlotKind)}
          aria-label={t('template.slotKind')}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {SLOT_KINDS.map(k => (
            <option key={k} value={k}>
              {t(`template.slotKinds.${k}`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={add}
          disabled={!label.trim()}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {t('template.addSlot')}
        </button>
      </div>
    </fieldset>
  )
}

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
    renderMode: TemplateRenderMode
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
  const [newLayoutName, setNewLayoutName] = useState('')

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

  /** Adds a layout the author named themselves (TMPL-9). */
  const addOwnLayout = () => {
    if (!newLayoutName.trim()) return
    setLayouts(prev => [
      ...prev,
      newLayout(
        newLayoutName,
        prev.map(l => l.type),
      ),
    ])
    setNewLayoutName('')
  }

  const setLayout = (index: number, patch: Partial<Layout>) =>
    setLayouts(prev =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    )

  /** Edits one box of a layout — its label, or what goes in it. The box's
   * name is deliberately not editable: slide content is stored under it. */
  const setSlot = (index: number, slotName: string, patch: Partial<SlotSpec>) =>
    setLayout(index, {
      slots: layouts[index]!.slots.map(s =>
        s.name === slotName ? { ...s, ...patch } : s,
      ),
    })

  /** Adds a box to a layout. On a layout that is already arranged the box
   * needs somewhere to sit, or it would be saved but never drawn. */
  const addSlot = (index: number, label: string, kind: SlotKind) => {
    const layout = layouts[index]!
    const slotName = slotNameFrom(
      label,
      layout.slots.map(s => s.name),
    )
    const positions = layout.elementPositions ?? {}
    setLayout(index, {
      slots: [...layout.slots, { name: slotName, kind, label: label.trim() }],
      elementPositions:
        Object.keys(positions).length > 0
          ? { ...positions, [slotName]: { ...NEW_BOX } }
          : positions,
    })
  }

  /** Removes a box, and the arrangement entry that placed it. */
  const removeSlot = (index: number, slotName: string) => {
    const layout = layouts[index]!
    const positions = { ...(layout.elementPositions ?? {}) }
    delete positions[slotName]
    setLayout(index, {
      slots: layout.slots.filter(s => s.name !== slotName),
      elementPositions: positions,
    })
  }

  // The preview reflects the draft, so a colour change is visible before it
  // is saved rather than after.
  const draft: Template = {
    ...template,
    name,
    theme,
    layouts,
    renderMode: renderModeOf(layouts),
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        onSave({
          name,
          renderMode: renderModeOf(layouts),
          theme,
          layouts,
          visibility,
        })
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
        {/* A template carries every conventional layout (TMPL-2), which is
            eight editors' worth of controls. Each one folds away behind a
            summary of what it is, so the page is a list of layouts and only
            the one being worked on is open. */}
        {layouts.map((layout, i) => (
          <details
            key={layout.type}
            className="group rounded-md border border-slate-200 [&[open]]:pb-3"
          >
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-700 marker:content-none hover:bg-slate-50">
              {/* The native marker is hidden, so say "this opens" with an
                  arrow that turns as it does. */}
              <ChevronRight
                aria-hidden
                className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90"
              />
              <span className="font-medium">{layout.label}</span>
              <span className="text-xs text-slate-400">
                {t('template.boxCount', { count: layout.slots.length })}
              </span>
            </summary>
            <div className="px-3">
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
                  <LayoutSlots
                    layout={layout}
                    onAdd={(label, kind) => addSlot(i, label, kind)}
                    onRename={(slotName, label) =>
                      setSlot(i, slotName, { label })
                    }
                    onRekind={(slotName, kind) =>
                      setSlot(i, slotName, { kind })
                    }
                    onRemove={slotName => removeSlot(i, slotName)}
                  />
                  <TemplateArrangement
                    layout={layout}
                    onChange={elementPositions =>
                      setLayout(i, { elementPositions })
                    }
                  />
                </div>
              )}
            </div>
          </details>
        ))}
        {/* Two ways to gain a layout: reuse a conventional type (TMPL-2), so
            layouts stay comparable across templates, or name one of your own
            when none of them describes the design (TMPL-9). */}
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600">
            {t('template.newLayout')}
          </span>
          <input
            value={newLayoutName}
            onChange={e => setNewLayoutName(e.target.value)}
            // Enter here means "add this layout", not "save the template"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addOwnLayout()
              }
            }}
            placeholder={t('template.newLayoutName')}
            aria-label={t('template.newLayoutName')}
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={addOwnLayout}
            disabled={!newLayoutName.trim()}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {t('template.newLayoutAdd')}
          </button>
        </div>
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
