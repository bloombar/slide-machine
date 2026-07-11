/**
 * Template chooser (TMPL-1, minimal): radio cards with theme swatches.
 */
import type { Template } from '@slide-machine/shared'

interface Props {
  templates: Template[]
  value: string
  onChange: (id: string) => void
}

const swatch = (theme: Record<string, unknown>, key: string): string =>
  typeof theme[key] === 'string' ? (theme[key] as string) : '#334155'

export default function TemplatePicker({ templates, value, onChange }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Slide template"
      className="flex flex-wrap gap-3"
    >
      {templates.map(t => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={value === t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 ${
            value === t.id ? 'border-indigo-600' : 'border-slate-200'
          }`}
        >
          <span
            aria-hidden
            className="flex h-8 w-12 items-center justify-center rounded"
            style={{ backgroundColor: swatch(t.theme, 'background') }}
          >
            <span
              className="h-2 w-6 rounded-sm"
              style={{ backgroundColor: swatch(t.theme, 'accent') }}
            />
          </span>
          <span className="font-medium">{t.name}</span>
        </button>
      ))}
    </div>
  )
}
