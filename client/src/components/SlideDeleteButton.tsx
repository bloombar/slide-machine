/**
 * Owner-only delete affordance superimposed over a slide's top-right
 * corner. Sits above the SlideNavZones hotspots (like editable text) so
 * clicking it deletes instead of navigating.
 */
import { Trash2 } from 'lucide-react'

interface Props {
  label: string
  onDelete: () => void
}

export default function SlideDeleteButton({ label, onDelete }: Props) {
  return (
    <button
      aria-label={label}
      onClick={onDelete}
      className="absolute top-3 right-3 z-10 rounded-full bg-black/30 p-2 text-white hover:bg-red-600"
    >
      <Trash2 className="h-4 w-4" aria-hidden />
    </button>
  )
}
