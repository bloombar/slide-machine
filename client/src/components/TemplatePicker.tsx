/**
 * Template chooser (TMPL-1, minimal): radio cards with theme swatches.
 */
import { useTranslation } from 'react-i18next'
import type { Template } from '@slide-machine/shared'
import { templateName } from '../i18n/templateName'

interface Props {
  templates: Template[]
  value: string
  onChange: (id: string) => void
}

const swatch = (theme: Record<string, unknown>, key: string): string =>
  typeof theme[key] === 'string' ? (theme[key] as string) : '#334155'

export default function TemplatePicker({ templates, value, onChange }: Props) {
  const { t } = useTranslation()
  return (
    <div
      role="radiogroup"
      aria-label={t('template.label')}
      className="flex flex-wrap gap-3"
    >
      {templates.map(template => (
        <button
          key={template.id}
          type="button"
          role="radio"
          aria-checked={value === template.id}
          onClick={() => onChange(template.id)}
          className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 ${
            value === template.id ? 'border-indigo-600' : 'border-slate-200'
          }`}
        >
          <span
            aria-hidden
            className="flex h-8 w-12 items-center justify-center rounded"
            style={{ backgroundColor: swatch(template.theme, 'background') }}
          >
            <span
              className="h-2 w-6 rounded-sm"
              style={{ backgroundColor: swatch(template.theme, 'accent') }}
            />
          </span>
          <span className="font-medium">{templateName(t, template)}</span>
        </button>
      ))}
    </div>
  )
}
