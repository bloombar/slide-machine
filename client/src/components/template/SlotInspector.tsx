/**
 * What the right-hand column shows when a box is selected.
 *
 * Everything about one box: what it holds, how it arranges anything inside it,
 * how it is painted, and where it sits in the paint order. An "×" hands the
 * column back to the layout's own settings.
 *
 * A box's machine *name* is deliberately not editable — a slide's content is
 * stored under it, so renaming would orphan what people have written. The
 * label is theirs to change.
 */
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type {
  BoxStyle,
  ContainerSpec,
  LayoutNode,
  SlotKind,
  SlotSpec,
} from '@slide-machine/shared'
import {
  MAX_SLOT_DESCRIPTION,
  SLOT_KINDS as SHARED_SLOT_KINDS,
  TEXT_STYLE_ROLES,
} from '@slide-machine/shared'
import { FONT_STACKS } from '../slide/fonts'
import { HIGHLIGHTED_LANGUAGES } from '../slide/code-languages'
import type { ThemeTextStyles } from '../slide/theme'

/** The kinds of content a box can hold — the closed menu TMPL-9 defines,
 * offered in the order it lists them. */
const SLOT_KINDS: SlotKind[] = SHARED_SLOT_KINDS

/** The languages a code box can be highlighted as — the set the renderer
 * carries a grammar for (components/slide/Code.tsx). Offering one it cannot
 * highlight would be a promise the slide does not keep. */
const CODE_LANGUAGES = HIGHLIGHTED_LANGUAGES

/** The ways a box can arrange other boxes instead of holding content. */
const CONTENT_LAYOUTS = ['column', 'row', 'grid'] as const

/** What a box is: something that shows content, or something that arranges
 * boxes that do. One question for the author, because for them it is one. */
export type ContentType = SlotKind | (typeof CONTENT_LAYOUTS)[number]

const JUSTIFY = ['start', 'center', 'end', 'between', 'around', 'evenly']
const ALIGN_ITEMS = ['start', 'center', 'end', 'stretch']
const ALIGN = ['start', 'center', 'end']

/** A number field over a value stored as a fraction but shown as a percent,
 * so an author types "8" rather than "0.08". */
const percentOf = (v: number | undefined): string =>
  v === undefined ? '' : String(Math.round(v * 1000) / 10)

const toFraction = (raw: string): number | undefined => {
  if (raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n / 100 : undefined
}

const toNumber = (raw: string): number | undefined => {
  if (raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-600">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'rounded-md border border-slate-300 px-2 py-1 text-sm min-w-0'

export default function SlotInspector({
  node,
  spec,
  parent,
  canMoveEarlier,
  canMoveLater,
  onNode,
  onStyle,
  onSpec,
  onContentType,
  onContainer,
  onReorder,
  onClose,
  onRecord,
  textStyles,
}: {
  node: LayoutNode
  /** The slot's declaration, when this box shows one. Containers and
   * decoration have none. */
  spec?: SlotSpec
  /** The container this box sits in, which decides how it is placed. */
  parent?: ContainerSpec
  canMoveEarlier: boolean
  canMoveLater: boolean
  onNode: (patch: Partial<LayoutNode>) => void
  onStyle: (patch: Partial<BoxStyle>) => void
  onSpec: (patch: Partial<SlotSpec>) => void
  /** Changes what the box is. Turning content into an arrangement, or back,
   * is a change of kind rather than of setting, so the editor does the work. */
  onContentType: (next: ContentType) => void
  onContainer: (patch: Partial<ContainerSpec>) => void
  onReorder: (delta: number) => void
  onClose: () => void
  onRecord: (key?: string) => void
  /** The template's text styles, for the budget a box inherits. */
  textStyles: ThemeTextStyles
}) {
  const { t } = useTranslation()
  const style = node.style ?? {}
  const container = node.container
  const isFree = Boolean(node.free)

  /**
   * Whether type settings mean anything for this box.
   *
   * A picture sets no type, and neither does bare decoration — a typeface and
   * a weight there are controls that change nothing. A container keeps them,
   * since type inherits down to whatever it holds.
   */
  const holdsText = spec ? spec.kind !== 'image' : Boolean(container)
  /** A picture fills its box, so nothing painted behind it is ever seen. */
  const showsFill = spec?.kind !== 'image'
  /**
   * Whether to offer "where the contents sit".
   *
   * Only a box holding words: it aligns its own text inside itself. A
   * container arranges *boxes*, and does that through Spread and Line up in
   * its Arrangement settings — offering both would be two controls for one
   * decision, and only one of them would work. A picture fills its box and
   * decoration has no contents at all.
   */
  const placesContents = Boolean(spec) && spec?.kind !== 'image'

  /** What this box would hold if it stated nothing itself — shown as the
   * placeholder in the limit fields, so the number in force is visible
   * without pretending the box chose it. */
  const inherited = style.textStyle ? (textStyles[style.textStyle] ?? {}) : {}

  /** What the single "what goes in it" control reads. */
  const contentType: ContentType = container
    ? container.mode === 'grid'
      ? 'grid'
      : container.direction === 'row'
        ? 'row'
        : 'column'
    : (spec?.kind ?? 'text')

  const patchStyle = (patch: Partial<BoxStyle>, key?: string) => {
    onRecord(key)
    onStyle(patch)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-700">
          {t('template.boxSettings')}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('template.backToLayout')}
          title={t('template.backToLayout')}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* What it holds — content of some kind, or an arrangement of other
          boxes. One question, because for the author it is one: a box either
          shows something or organises things that do. */}
      <div className="flex flex-col gap-3">
        <Field label={t('template.slotKind')}>
          <select
            value={contentType}
            onChange={e => {
              onRecord()
              onContentType(e.target.value as ContentType)
            }}
            className={inputClass}
          >
            <optgroup label={t('template.contentGroup.holds')}>
              {SLOT_KINDS.map(k => (
                <option key={k} value={k}>
                  {t(`template.slotKinds.${k}`)}
                </option>
              ))}
            </optgroup>
            <optgroup label={t('template.contentGroup.arranges')}>
              {CONTENT_LAYOUTS.map(k => (
                <option key={k} value={k}>
                  {t(`template.contentLayouts.${k}`)}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>

        {spec && (
          <Field label={t('template.slotLabel')}>
            <input
              value={spec.label}
              onFocus={() => onRecord(`slot-label:${spec.name}`)}
              onChange={e => onSpec({ label: e.target.value })}
              className={inputClass}
            />
          </Field>
        )}

        {/* Which named style it follows, next to what it is: for most boxes
            this is the whole of the type decision, and the fields further
            down are the exceptions to it. */}
        {holdsText && (
          <Field label={t('template.textStyle')}>
            <select
              value={style.textStyle ?? ''}
              onChange={e =>
                patchStyle({ textStyle: e.target.value || undefined })
              }
              className={inputClass}
            >
              <option value="">{t('template.textStyleCustom')}</option>
              {TEXT_STYLE_ROLES.map(role => (
                <option key={role} value={role}>
                  {t(`template.textStyles.${role}`)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {/* Where this box goes. Floating is the box's own choice — no wrapper
          around it, and everything beside it keeps its arrangement.
          The outermost box is the slide, so it has no position to change. */}
      {parent && (
        <fieldset className="flex flex-col gap-2 border-t border-slate-200 pt-3">
          <legend className="text-xs font-medium text-slate-700">
            {t('template.placement')}
          </legend>
          {/* Says where the decision is being made, so an author looking for
              it knows to go to the box that contains this one. */}
          {!isFree && (
            <p className="text-xs text-slate-500">
              {t('template.placedByParent')}
            </p>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={isFree}
              onChange={e => {
                onRecord()
                onNode({ free: e.target.checked || undefined })
              }}
            />
            {t('template.placeFreely')}
          </label>
          {isFree && (
            <p className="text-xs text-slate-500">
              {t('template.placeFreelyOn')}
            </p>
          )}
        </fieldset>
      )}

      {/* The details of the arrangement, once the box is one. Which way it
          runs is not among them — "a row" and "a column" already said that. */}
      {container && (
        <fieldset className="flex flex-col gap-2 border-t border-slate-200 pt-3">
          <legend className="text-xs font-medium text-slate-700">
            {t('template.arrangement')}
          </legend>

          {container.mode === 'flex' && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={Boolean(container.wrap)}
                onChange={e => {
                  onRecord()
                  onContainer({ wrap: e.target.checked })
                }}
              />
              {t('template.wrap')}
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            {container.mode === 'grid' && (
              <>
                <Field label={t('template.columns')}>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={container.columns ?? ''}
                    onFocus={() => onRecord(`grid-cols:${node.id}`)}
                    onChange={e =>
                      onContainer({ columns: toNumber(e.target.value) })
                    }
                    className={inputClass}
                  />
                </Field>
                <Field label={t('template.rows')}>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={container.rows ?? ''}
                    onFocus={() => onRecord(`grid-rows:${node.id}`)}
                    onChange={e =>
                      onContainer({ rows: toNumber(e.target.value) })
                    }
                    className={inputClass}
                  />
                </Field>
              </>
            )}
            <Field label={t('template.gap')}>
              <input
                type="number"
                min={0}
                step={0.5}
                value={container.gap ?? ''}
                onFocus={() => onRecord(`gap:${node.id}`)}
                onChange={e => onContainer({ gap: toNumber(e.target.value) })}
                className={inputClass}
              />
            </Field>
            <Field label={t('template.alignItems')}>
              <select
                value={container.alignItems ?? 'stretch'}
                onChange={e => {
                  onRecord()
                  onContainer({
                    alignItems: e.target.value as ContainerSpec['alignItems'],
                  })
                }}
                className={inputClass}
              >
                {ALIGN_ITEMS.map(v => (
                  <option key={v} value={v}>
                    {t(`template.alignValues.${v}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('template.justify')}>
              <select
                value={container.justify ?? 'start'}
                onChange={e => {
                  onRecord()
                  onContainer({
                    justify: e.target.value as ContainerSpec['justify'],
                  })
                }}
                className={inputClass}
              >
                {JUSTIFY.map(v => (
                  <option key={v} value={v}>
                    {t(`template.justifyValues.${v}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </fieldset>
      )}

      {/* The room the box takes and what it does with it: how much of its
          container it claims, and how it is padded, filled and cornered. */}
      <fieldset className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-3">
        <legend className="text-xs font-medium text-slate-700">
          {t('template.sizing')}
        </legend>
        {parent && !isFree && (
          <>
            {parent.mode === 'grid' ? (
              <>
                <Field label={t('template.colSpan')}>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={node.colSpan ?? ''}
                    onFocus={() => onRecord(`colspan:${node.id}`)}
                    onChange={e =>
                      onNode({ colSpan: toNumber(e.target.value) })
                    }
                    className={inputClass}
                  />
                </Field>
                <Field label={t('template.rowSpan')}>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={node.rowSpan ?? ''}
                    onFocus={() => onRecord(`rowspan:${node.id}`)}
                    onChange={e =>
                      onNode({ rowSpan: toNumber(e.target.value) })
                    }
                    className={inputClass}
                  />
                </Field>
              </>
            ) : null}
            <Field label={t('template.width')}>
              <input
                type="number"
                min={0}
                max={100}
                value={percentOf(node.width)}
                onFocus={() => onRecord(`width:${node.id}`)}
                onChange={e => onNode({ width: toFraction(e.target.value) })}
                className={inputClass}
              />
            </Field>
            <Field label={t('template.height')}>
              <input
                type="number"
                min={0}
                max={100}
                value={percentOf(node.height)}
                onFocus={() => onRecord(`height:${node.id}`)}
                onChange={e => onNode({ height: toFraction(e.target.value) })}
                className={inputClass}
              />
            </Field>
            {/* What the box does with whatever room is left once the sizes
                above are honoured — so it reads after them, not before. */}
            {parent.mode !== 'grid' && (
              <Field label={t('template.grow')}>
                <input
                  type="number"
                  min={0}
                  value={node.grow ?? ''}
                  onFocus={() => onRecord(`grow:${node.id}`)}
                  onChange={e => onNode({ grow: toNumber(e.target.value) })}
                  className={inputClass}
                />
              </Field>
            )}
          </>
        )}
        <Field label={t('template.padding')}>
          <input
            type="number"
            min={0}
            step={0.5}
            value={style.padding ?? ''}
            onFocus={() => onRecord(`padding:${node.id}`)}
            onChange={e => onStyle({ padding: toNumber(e.target.value) })}
            className={inputClass}
          />
        </Field>
        <Field label={t('template.radius')}>
          <input
            type="number"
            min={0}
            step={0.25}
            value={style.radius ?? ''}
            onFocus={() => onRecord(`radius:${node.id}`)}
            onChange={e => onStyle({ radius: toNumber(e.target.value) })}
            className={inputClass}
          />
        </Field>
        {showsFill && (
          <Field label={t('template.background')}>
            {/* The swatch and the way back from it, together: a colour input
                can never say "none", so clearing has to sit beside it. */}
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={style.background ?? '#ffffff'}
                onChange={e => patchStyle({ background: e.target.value })}
                className="h-8 w-12 shrink-0 rounded border border-slate-300"
              />
              <button
                type="button"
                onClick={() => {
                  onRecord()
                  onStyle({ background: undefined })
                }}
                className="text-xs text-slate-500 underline hover:text-slate-700"
              >
                {t('template.clearFill')}
              </button>
            </div>
          </Field>
        )}
      </fieldset>

      {/* What the box overrides about the style it follows. Skipped for a
          picture or bare decoration: neither sets any type, so a typeface and
          a weight there would change nothing. */}
      {holdsText && (
        <fieldset className="flex flex-col gap-2 border-t border-slate-200 pt-3">
          <legend className="text-xs font-medium text-slate-700">
            {t('template.textLabel')}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('template.fontSize')}>
              <input
                type="number"
                min={0.5}
                step={0.25}
                value={style.fontSize ?? ''}
                onFocus={() => onRecord(`fontsize:${node.id}`)}
                onChange={e => onStyle({ fontSize: toNumber(e.target.value) })}
                className={inputClass}
              />
            </Field>
            <Field label={t('template.fontWeight')}>
              <select
                value={style.fontWeight ?? ''}
                onChange={e =>
                  patchStyle({ fontWeight: toNumber(e.target.value) })
                }
                className={inputClass}
              >
                <option value="">{t('template.inherit')}</option>
                {[300, 400, 500, 600, 700, 800].map(w => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('template.textColor')}>
            {/* The same swatch size as the fill's, so the two colour controls
                read as a pair rather than as different kinds of thing. */}
            <input
              type="color"
              value={style.color ?? '#000000'}
              onChange={e => patchStyle({ color: e.target.value })}
              className="h-8 w-12 shrink-0 rounded border border-slate-300"
            />
          </Field>
          {/* What the AI should put here, and how much — the author's own
              words, then the ceilings that hold whatever it returns
              (TMPL-10). Kept together because they are read together. */}
          {spec && (
            <Field label={t('template.slotInstructions')}>
              <textarea
                rows={2}
                maxLength={MAX_SLOT_DESCRIPTION}
                placeholder={t('template.slotInstructionsHint')}
                value={spec.description ?? ''}
                onFocus={() => onRecord(`slot-description:${spec.name}`)}
                onChange={e =>
                  onSpec({ description: e.target.value || undefined })
                }
                className={inputClass}
              />
            </Field>
          )}
          {spec && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={Boolean(spec.required)}
                onChange={e => {
                  onRecord()
                  onSpec({ required: e.target.checked || undefined })
                }}
              />
              {t('template.slotRequired')}
            </label>
          )}
          {spec && (
            <Field label={t('template.maxChars')}>
              <input
                type="number"
                min={1}
                placeholder={inherited.maxChars?.toString() ?? ''}
                value={spec.maxChars ?? ''}
                onFocus={() => onRecord(`maxchars:${spec.name}`)}
                onChange={e => onSpec({ maxChars: toNumber(e.target.value) })}
                className={inputClass}
              />
            </Field>
          )}
          {spec && spec.kind !== 'image' && (
            <Field label={t('template.maxWords')}>
              <input
                type="number"
                min={1}
                value={spec.maxWords ?? ''}
                onFocus={() => onRecord(`maxwords:${spec.name}`)}
                onChange={e => onSpec({ maxWords: toNumber(e.target.value) })}
                className={inputClass}
              />
            </Field>
          )}
          {spec?.kind === 'code' && (
            /* Which language the listing is highlighted as. Set on the
               template rather than per slide, so a Python box is Python on
               every slide built from the design (TMPL-9). */
            <Field label={t('template.slotLanguage.label')}>
              <select
                value={
                  typeof spec.options?.language === 'string'
                    ? spec.options.language
                    : ''
                }
                onChange={e =>
                  onSpec({
                    options: e.target.value
                      ? { ...spec.options, language: e.target.value }
                      : undefined,
                  })
                }
                className={inputClass}
              >
                <option value="">{t('template.slotLanguage.auto')}</option>
                {CODE_LANGUAGES.map(l => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {spec?.kind === 'bullets' && (
            <Field label={t('template.maxItems')}>
              <input
                type="number"
                min={1}
                max={50}
                placeholder={inherited.maxItems?.toString() ?? ''}
                value={spec.maxItems ?? ''}
                onFocus={() => onRecord(`maxitems:${spec.name}`)}
                onChange={e => onSpec({ maxItems: toNumber(e.target.value) })}
                className={inputClass}
              />
            </Field>
          )}
          <Field label={t('template.fontFamily')}>
            <select
              value={style.fontFamily ?? ''}
              onChange={e =>
                patchStyle({ fontFamily: e.target.value || undefined })
              }
              className={inputClass}
            >
              <option value="">{t('template.inherit')}</option>
              {FONT_STACKS.map(f => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>
      )}

      {/* Where the box's contents sit inside it — separate from the type
          settings, since a container places boxes rather than words. */}
      {placesContents && (
        <fieldset className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-3">
          <legend className="text-xs font-medium text-slate-700">
            {t('template.position')}
          </legend>
          <Field label={t('template.align')}>
            <select
              value={style.align ?? 'start'}
              onChange={e =>
                patchStyle({ align: e.target.value as BoxStyle['align'] })
              }
              className={inputClass}
            >
              {ALIGN.map(v => (
                <option key={v} value={v}>
                  {t(`template.alignValues.${v}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('template.vAlign')}>
            <select
              value={style.vAlign ?? 'start'}
              onChange={e =>
                patchStyle({ vAlign: e.target.value as BoxStyle['vAlign'] })
              }
              className={inputClass}
            >
              {ALIGN.map(v => (
                <option key={v} value={v}>
                  {t(`template.alignValues.${v}`)}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>
      )}

      {/* Paint order. Only offered where boxes can overlap: siblings in a flex
          or grid container cannot, so "forward" there would quietly mean
          "later in the flow", which is a different thing entirely. */}
      {isFree && (
        <fieldset className="flex flex-col gap-2 border-t border-slate-200 pt-3">
          <legend className="text-xs font-medium text-slate-700">
            {t('template.arrangeOrder')}
          </legend>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canMoveLater}
              onClick={() => {
                onRecord()
                onReorder(1)
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {t('template.bringForward')}
            </button>
            <button
              type="button"
              disabled={!canMoveEarlier}
              onClick={() => {
                onRecord()
                onReorder(-1)
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {t('template.sendBackward')}
            </button>
          </div>
        </fieldset>
      )}

      {/* Deleting the box is not here: it is on its row in the outline, a
          click away from wherever the pointer already is. */}
    </div>
  )
}
