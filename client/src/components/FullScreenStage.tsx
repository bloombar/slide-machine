/**
 * Full-screen overlay for slide viewing (PLAY-5): an in-app overlay, not
 * the browser Fullscreen API. Portaled to document.body so it paints over
 * the primary nav (AppShell/PublicShell, z-50) at an equal z-index, with a
 * stage sized to the largest 16:9 box that fits the viewport and centred
 * both ways. The leftover letterbox space is painted in the template's own
 * `imageBackground` colour — the same fill a letterboxed picture sits on
 * inside an image slot (`slots.tsx`) — so the surround belongs to the
 * design rather than to the app.
 *
 * The stage is sized by CSS alone (`min(100vw, 100vh * 16/9)`), never a
 * `transform: scale()`: SlideView is already `aspect-video w-full` inside a
 * `@container`, so the slide's own type and metrics scale from the stage's
 * width with no extra work. This is the actual largest 16:9 box that fits
 * the viewport — SPEC PLAY-5 is explicit that one of the two axes is filled
 * exactly — with nothing subtracted from it: SlideNavZones' prev/next
 * chevrons, which would otherwise land off screen on a 16:9-or-narrower
 * viewport (see its own module comment), are kept on screen by drawing them
 * INSIDE the slide's edge here (`inset`, passed from `renderCarouselSlide`
 * in DeckViewerPage) rather than by shrinking the stage to make room
 * outside it — an earlier version of this file did the latter, and gave up
 * up to 112px of "largest" to buy it back (docs/DECISIONS.md).
 */
import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import Portal from './Portal'
import Tooltip from './Tooltip'

interface Props {
  /** The letterbox fill — `themeColors(template.theme).imageBackground`. */
  background: string
  onClose: () => void
  children: ReactNode
}

/** The largest-16:9-box-that-fits-the-viewport rule, applied as the stage's
 * inline width. Exported (and mirrored onto a `data-stage-width` attribute
 * below) so a unit test can assert it directly — jsdom's style setter
 * silently drops `min()`/`calc()` values it can't parse, so reading it back
 * off `element.style` proves nothing there; real browsers, and the e2e spec
 * that measures the rendered box, are what this actually has to hold up in. */
export const STAGE_WIDTH_RULE = 'min(100vw, calc(100vh * 16 / 9))'

export default function FullScreenStage({
  background,
  onClose,
  children,
}: Props) {
  const { t } = useTranslation()
  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: background }}
      >
        {/* The largest 16:9 box that fits the viewport: width-capped by the
            viewport's width, or by the viewport's height converted to a
            16:9 width, whichever is smaller. Height then falls out of the
            child's own aspect-video ratio — no JS measurement, no resize
            listener. */}
        <div
          className="relative"
          data-stage-width={STAGE_WIDTH_RULE}
          style={{ width: STAGE_WIDTH_RULE }}
        >
          {children}
          {/* The `absolute` positioning has to land on a wrapper around the
              Tooltip, not on the button itself: Tooltip's own root span is
              `relative`, so an absolutely-positioned button inside it would
              anchor to that span instead of the stage — and the span, left
              in normal flow, would add its own height to the stage besides
              (this is exactly the image slot's own hover-cluster shape in
              slots.tsx, for the same reason). */}
          {/* Parked one button-width left of the slide's own kebab menu
              (SlideMenu, `top-3 end-3`), and above it: at 16:9 the stage
              fills the viewport exactly, so a close control in the very
              corner would sit under the kebab and swallow its own clicks.
              z-40 clears the kebab's raised z-30. */}
          <div className="absolute top-3 end-12 z-40">
            <Tooltip label={t('deck.fullScreen.exit')}>
              <button
                aria-label={t('deck.fullScreen.exit')}
                onClick={onClose}
                // Drawn like the image slot's Remove button (slots.tsx),
                // minus its red hover: this reverts a view rather than
                // deleting anything, so the hover stays neutral. Always
                // visible — a hover-gated control has no touch equivalent.
                className="rounded-md bg-white/90 p-1.5 text-slate-700 shadow hover:bg-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </Portal>
  )
}
