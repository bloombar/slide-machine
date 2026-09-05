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
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
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

/** The close control's placement (PLAY-5, round 6): whether it fits in a
 * true corner of the letterbox surround, or has to stay parked beside the
 * kebab, is decided by the letterbox bars' actual WIDTH IN PIXELS — not by
 * aspect ratio, which a CSS media query can express but which is the wrong
 * quantity: a 2152x1080 window has a ratio (1.99) just under any sensible
 * "wide" threshold, but its side bars are 116px wide, far more than the
 * control needs. Aspect ratio and bar width only agree with each other at
 * one height; at every other height they disagree, and a ratio threshold
 * either strands the control on the slide when the screen genuinely is
 * large enough, or promises a corner spot a shorter/narrower window can't
 * actually supply.
 *
 * Round 5 read the bars off `window.innerWidth`/`innerHeight` and compared
 * them to a threshold built from a hardcoded `REM_PX = 16`. Both were wrong
 * in ways that only show up away from the default: `innerWidth` includes a
 * classic scrollbar the `fixed inset-0` overlay does not get (it is laid
 * out at `clientWidth`), so a window with a visible scrollbar reports more
 * room than the overlay actually has; and a page with no root font-size
 * override still runs at whatever the browser's default is, which is not
 * always 16px. Both are fixed by measuring the real boxes instead of
 * inferring them: the overlay and stage elements' own rects give the bars
 * directly (no scrollbar to mis-subtract), and the close button's own
 * rendered width already reflects the real root font-size with no
 * conversion needed — only the corner inset, which is not part of the
 * button's own box, still needs converting from rem, and that reads the
 * root element's *actual* computed font-size rather than assuming one.
 */
/** Matches SlideMenu's own kebab inset (`top-3 end-3`), so the corner
 * position sits at the same distance from the edge the kebab does. */
const CORNER_INSET_REM = 0.75
export const CORNER_INSET_RULE = `${CORNER_INSET_REM}rem`
/** Parked (non-corner) position: one button-width left of the kebab,
 * tracking the stage edge, so it never overlaps SlideMenu's own end-3
 * corner slot. */
const PARKED_OFFSET_REM = 3
export const PARKED_INSET_RULE = `calc((100vw - ${STAGE_WIDTH_RULE}) / 2 + ${PARKED_OFFSET_REM}rem)`

/** The two letterbox bar widths (px) — half the leftover space on each axis
 * between the overlay (the full viewport, minus any scrollbar) and the
 * stage (the largest 16:9 box cut out of it). Takes plain numbers — the
 * overlay's and stage's own measured rects — rather than measuring anything
 * itself, so a unit test can assert it directly without a browser or a
 * ResizeObserver. */
export const letterboxBars = (
  overlayWidth: number,
  overlayHeight: number,
  stageWidth: number,
  stageHeight: number,
) => ({
  sideBar: (overlayWidth - stageWidth) / 2,
  topBar: (overlayHeight - stageHeight) / 2,
})

/** Whether either bar is wide enough to hold the control in the true corner
 * rather than parked beside the kebab. Takes the threshold as a plain
 * number too — the component derives it from the button's own measured
 * footprint, but the boundary itself is just a comparison and is tested as
 * one, independent of how that number gets produced. */
export const isCornerPosition = (
  sideBar: number,
  topBar: number,
  thresholdPx: number,
): boolean => sideBar >= thresholdPx || topBar >= thresholdPx

export default function FullScreenStage({
  background,
  onClose,
  children,
}: Props) {
  const { t } = useTranslation()
  const overlayRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Parked is the conservative default — it always fits, tracking the stage
  // edge rather than claiming a corner that might not be there. It is never
  // actually painted: useLayoutEffect below measures and corrects it before
  // the browser's first paint, on every mount (see the effect's own
  // comment for why a plain useEffect would let this default flash first).
  const [corner, setCorner] = useState(false)
  useLayoutEffect(() => {
    const overlay = overlayRef.current
    const stage = stageRef.current
    const button = buttonRef.current
    if (!overlay || !stage || !button) return
    const measure = () => {
      const overlayRect = overlay.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      const buttonRect = button.getBoundingClientRect()
      // The button's own rect already reflects the real root font-size (its
      // padding and icon are rem-based too) — only the corner inset still
      // needs converting from rem, and it reads the root element's actual
      // computed font-size rather than assuming the Tailwind default.
      const rootFontSizePx = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      )
      const thresholdPx = buttonRect.width + CORNER_INSET_REM * rootFontSizePx
      const { sideBar, topBar } = letterboxBars(
        overlayRect.width,
        overlayRect.height,
        stageRect.width,
        stageRect.height,
      )
      setCorner(isCornerPosition(sideBar, topBar, thresholdPx))
    }
    // Measured synchronously here (inside a layout effect, before the
    // browser paints) rather than waiting on the observer below: a
    // ResizeObserver's own first notification is queued asynchronously
    // even for the size an element already has when observation starts, so
    // relying on it alone would paint the wrong position once on every
    // mount and correct it a frame later.
    measure()
    // The button's own size never changes with `corner` (only the wrapper's
    // `insetInlineEnd` does, and that is a position, not a size), so
    // observing it back cannot loop on this state change — it only re-fires
    // for an actual viewport/overlay resize.
    const observer = new ResizeObserver(measure)
    observer.observe(overlay)
    return () => observer.disconnect()
  }, [])
  return (
    <Portal>
      <div
        ref={overlayRef}
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: background }}
      >
        {/* The largest 16:9 box that fits the viewport: width-capped by the
            viewport's width, or by the viewport's height converted to a
            16:9 width, whichever is smaller. Height then falls out of the
            child's own aspect-video ratio — no JS measurement, no resize
            listener. */}
        <div
          ref={stageRef}
          className="relative"
          data-stage-width={STAGE_WIDTH_RULE}
          style={{ width: STAGE_WIDTH_RULE }}
        >
          {children}
        </div>
        {/* The `absolute` positioning has to land on a wrapper around the
            Tooltip, not on the button itself: Tooltip's own root span is
            `relative`, so an absolutely-positioned button inside it would
            anchor to that span instead of the overlay — and the span, left
            in normal flow, would add its own height besides (this is
            exactly the image slot's own hover-cluster shape in slots.tsx,
            for the same reason). Anchored to the overlay root — not the
            stage — so on any viewport wider or taller than 16:9 it sits in
            the letterbox surround rather than over the slide's own content;
            the overlay's `fixed inset-0` makes it the positioning context
            here just as it would for the stage. z-40 clears the kebab's
            raised z-30. */}
        <div
          className="absolute top-3 z-40"
          data-close-position={corner ? 'corner' : 'parked'}
          style={{
            insetInlineEnd: corner ? CORNER_INSET_RULE : PARKED_INSET_RULE,
          }}
        >
          {/* align="end": a centred nowrap label at a 12px corner inset
              overflows the viewport (measured 14-67px clipped across the
              app's languages) — pin its right edge to the button instead,
              matching every other right-edge tooltip (e.g. the matching
              "Full screen" enter button in DeckViewerPage). */}
          <Tooltip label={t('deck.fullScreen.exit')} align="end">
            <button
              ref={buttonRef}
              aria-label={t('deck.fullScreen.exit')}
              onClick={onClose}
              // Discreet, like the slide's own kebab menu (SlideMenu) rather
              // than a high-contrast white square: the letterbox it now
              // sits in, like the slide content the kebab already sits
              // over, is the template's own colour and can be light or
              // dark. Always visible — a hover-gated control has no touch
              // equivalent. bg-black/50 (not /30): over a light letterbox
              // (a template's imageBackground, or the app's own default
              // white) a white glyph on /30 measures ~2.3:1, short of WCAG
              // 1.4.11's 3:1 for a UI control; /50 lands at ~4.3:1 there
              // while staying a quiet pill rather than a white square.
              className="rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </Tooltip>
        </div>
      </div>
    </Portal>
  )
}
