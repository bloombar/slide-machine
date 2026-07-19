/**
 * Narration voice picker, shared by project and lecture settings. Nothing is
 * stored until a voice is explicitly chosen; the "default" option clears the
 * level so the value cascades (lecture → project → system default). Each voice
 * carries its own gender, so choosing one sets the gender automatically.
 */
import { TTS_VOICES } from '@slide-machine/shared'

interface Props {
  /** This level's own stored voice id; undefined = inherit. */
  value?: string
  /** What "inherit" means at this level, e.g. "Project setting". */
  defaultLabel: string
  onChange: (voice: string | null) => void
}

export default function VoiceSelect({ value, defaultLabel, onChange }: Props) {
  return (
    <select
      aria-label="Narration voice"
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      className="w-fit rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
    >
      <option value="">Default — {defaultLabel}</option>
      {TTS_VOICES.map(voice => (
        <option key={voice.id} value={voice.id}>
          {voice.label}
        </option>
      ))}
    </select>
  )
}
