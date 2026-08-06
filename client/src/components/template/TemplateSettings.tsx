/**
 * What the whole template shares, below the preview: its name, who can see
 * it, its default colours, its margins, and its text styles.
 *
 * The text styles are the reason this panel is worth its space. A layout's
 * boxes name a role — "body", "heading" — rather than carrying a size each,
 * so changing "body" here restyles every body box in every layout at once,
 * instead of sending the author round eight tabs to make the same edit.
 *
 * Margins are an authoring aid: the editor draws them and snaps boxes to
 * them, and nothing on the render path reads them, so changing one cannot
 * move a slide in a lecture that is already saved.
 */
import { useTranslation } from 'react-i18next'
import type { Template, TextStyleSpec } from '@slide-machine/shared'
import { TEXT_STYLE_ROLES } from '@slide-machine/shared'
import { FONT_STACKS } from '../slide/fonts'
import { themeTextStyles } from '../slide/theme'

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

const METRIC_KEYS = ['marginX', 'marginY', 'gap'] as const

const asColor = (theme: Record<string, unknown>, key: string): string =>
  typeof theme[key] === 'string' ? (theme[key] as string) : '#000000'

const asPercent = (v: unknown, fallback: number): number =>
  Math.round((typeof v === 'number' ? v : fallback) * 100)

const toNumber = (raw: string): number | undefined => {
  if (raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

export default function TemplateSettings({
  name,
  visibility,
  theme,
  onName,
  onVisibility,
  onTheme,
  onRecord,
}: {
  name: string
  visibility: Template['visibility']
  theme: Record<string, unknown>
  onName: (name: string) => void
  onVisibility: (v: Template['visibility']) => void
  onTheme: (patch: Record<string, unknown>) => void
  onRecord: (key?: string) => void
}) {
  const { t } = useTranslation()
  const styles = themeTextStyles(theme)

  const setStyle = (role: string, patch: Partial<TextStyleSpec>) => {
    const stored =
      theme.textStyles && typeof theme.textStyles === 'object'
        ? (theme.textStyles as Record<string, unknown>)
        : {}
    onTheme({
      textStyles: {
        ...stored,
        [role]: { ...styles[role], ...patch },
      },
    })
  }

  return (
    <div className="flex flex-col gap-5 border-t border-slate-200 pt-5">
      {/* A step above the field labels under it, a step below the modal's
          own "Template" heading. */}
      <h3 className="text-base font-semibold text-slate-800">
        {t('template.templateSettings')}
      </h3>

      <div className="flex flex-col gap-4 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">
            {t('template.nameLabel')}
          </span>
          <input
            value={name}
            onFocus={() => onRecord('template-name')}
            onChange={e => onName(e.target.value)}
            maxLength={80}
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="flex flex-1 flex-col gap-1">
          {/* The hint sits outside the label: inside, it would become part of
              the control's accessible name. */}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">
              {t('template.visibilityLabel')}
            </span>
            <select
              value={visibility}
              onChange={e => {
                onRecord()
                onVisibility(e.target.value as Template['visibility'])
              }}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="private">
                {t('template.visibility.private')}
              </option>
              <option value="unlisted">
                {t('template.visibility.unlisted')}
              </option>
              <option value="public">{t('template.visibility.public')}</option>
            </select>
          </label>
          <p className="text-xs text-slate-500">
            {t(`template.visibilityHint.${visibility}`)}
          </p>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-700">
          {t('template.themeLabel')}
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEME_KEYS.map(key => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="color"
                value={asColor(theme, key)}
                onChange={e => {
                  onRecord(`theme:${key}`)
                  onTheme({ [key]: e.target.value })
                }}
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

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-700">
          {t('template.spacingLabel')}
        </legend>
        <p className="text-xs text-slate-500">{t('template.spacingHint')}</p>
        <div className="grid grid-cols-3 gap-2 sm:max-w-sm">
          {METRIC_KEYS.map(key => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-slate-600">
                {t(`template.metric.${key}`)}
              </span>
              <input
                type="number"
                min={0}
                max={45}
                value={asPercent(theme[key], key === 'gap' ? 0.03 : 0.06)}
                onFocus={() => onRecord(`metric:${key}`)}
                onChange={e => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n)) onTheme({ [key]: n / 100 })
                }}
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-slate-700">
          {t('template.textStylesLabel')}
        </legend>
        <p className="text-xs text-slate-500">{t('template.textStylesHint')}</p>
        <div className="flex flex-col gap-2">
          {/* The column headings are written once. Repeating them on every
              row would give seven controls the same visible label, which
              reads as ambiguous to anyone navigating by label. */}
          <div className="flex flex-wrap items-end gap-2 text-[0.65rem] text-slate-500">
            <span className="w-24 shrink-0" />
            <span className="w-40">{t('template.fontFamily')}</span>
            <span className="w-20">{t('template.fontSize')}</span>
            <span className="w-20">{t('template.maxChars')}</span>
            <span className="w-20">{t('template.maxItems')}</span>
          </div>
          {TEXT_STYLE_ROLES.map(role => (
            <div key={role} className="flex flex-wrap items-end gap-2">
              <span className="w-24 shrink-0 text-xs text-slate-600">
                {t(`template.textStyles.${role}`)}
              </span>
              <div className="w-40">
                <select
                  value={styles[role]?.fontFamily ?? ''}
                  onChange={e => {
                    onRecord()
                    setStyle(role, {
                      fontFamily: e.target.value || undefined,
                    })
                  }}
                  aria-label={t('template.styleFont', {
                    style: t(`template.textStyles.${role}`),
                  })}
                  className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                >
                  <option value="">{t('template.inherit')}</option>
                  {FONT_STACKS.map(f => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="number"
                min={0.5}
                step={0.25}
                value={styles[role]?.fontSize ?? ''}
                onFocus={() => onRecord(`style-size:${role}`)}
                onChange={e => {
                  const n = Number(e.target.value)
                  setStyle(role, {
                    fontSize: Number.isFinite(n) ? n : undefined,
                  })
                }}
                aria-label={t('template.styleSize', {
                  style: t(`template.textStyles.${role}`),
                })}
                className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              {/* How much text a box in this style holds: what the AI is told
                  and what the server trims to. A box may say otherwise. */}
              <input
                type="number"
                min={1}
                value={styles[role]?.maxChars ?? ''}
                onFocus={() => onRecord(`style-chars:${role}`)}
                onChange={e =>
                  setStyle(role, { maxChars: toNumber(e.target.value) })
                }
                aria-label={t('template.styleChars', {
                  style: t(`template.textStyles.${role}`),
                })}
                className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              {/* Only a list has a number of points. */}
              {role === 'bullet' ? (
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={styles[role]?.maxItems ?? ''}
                  onFocus={() => onRecord(`style-items:${role}`)}
                  onChange={e =>
                    setStyle(role, { maxItems: toNumber(e.target.value) })
                  }
                  aria-label={t('template.styleItems', {
                    style: t(`template.textStyles.${role}`),
                  })}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              ) : (
                <span className="w-20" />
              )}
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
