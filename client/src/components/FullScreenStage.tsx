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

/** The close control's inset from the viewport's corner. A single formula
 * cannot hold across every aspect ratio: the "beside the kebab" position
 * (mid aspect ratios, where the side letterbox is too thin for a corner
 * control of its own) and the "true corner" position (wide or tall, where
 * the letterbox is thick enough to hold it) sit on OPPOSITE sides of the
 * kebab — sliding continuously between them means crossing straight over
 * it, which is exactly the collision this exists to avoid. So this is a
 * step, not a slide: three CSS states (`.fullscreen-close` in index.css),
 * chosen by `min-`/`max-aspect-ratio` media queries rather than an inline
 * `style` calc (an inline style can't be overridden by a class, so even the
 * default state has to be a class).
 *
 * 1. Default (roughly 4:3–2:1): one button-width left of the kebab,
 *    tracking the stage edge — `(100vw - min(100vw, 100vh*16/9)) / 2 + 3rem`
 *    (half the leftover width, i.e. one side bar, plus 3rem), which reduces
 *    to the old fixed `end-12` at exactly 16:9.
 * 2. Wide (`min-aspect-ratio: 2/1`): the true corner, `end-3` — at 2:1 each
 *    side bar is 0.111 × height (≥79px at 720 tall), comfortably clear of
 *    both the slide and the kebab.
 * 3. Tall (`max-aspect-ratio: 4/3`): also the true corner, `end-3` — it
 *    sits in the top letterbox, above the slide, and the kebab is below it.
 *
 * This constant is the default-state formula, mirrored onto a
 * `data-close-inset` attribute for a unit test the same way STAGE_WIDTH_RULE
 * is (jsdom drops `calc()` it can't parse); the wide/tall states only exist
 * in the built CSS and are proved by the e2e sweep instead (jsdom does not
 * evaluate media queries either). */
export const CLOSE_INSET_RULE =
  'calc((100vw - min(100vw, calc(100vh * 16 / 9))) / 2 + 3rem)'

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
          className="fullscreen-close absolute top-3 z-40"
          data-close-inset={CLOSE_INSET_RULE}
        >
          <Tooltip label={t('deck.fullScreen.exit')}>
            <button
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
