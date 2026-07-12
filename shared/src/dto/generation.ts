/**
 * The generation event shape (GEN-1/GEN-8): how slide updates reach the
 * client, whether from the live pipeline, a simulated session, or a
 * future streamed transport. Defined early per ROADMAP §5.1 — this is
 * the seam between the generation pipeline and the renderer.
 */
import type { Deck, Slide } from '../types/deck'
import type { Template } from '../types/template'

export type SlideEventKind = 'slide.new' | 'slide.update' | 'none'

/** One generation step's outcome. `none` = filler speech, nothing changed. */
export interface SlideEvent {
  kind: SlideEventKind
  slide?: Slide
}

/** Everything needed to render a deck: returned by deck.get and the viewer route. */
export interface DeckViewResponse {
  deck: Deck
  slides: Slide[]
  template: Template
  /** Whether the requesting user may edit (owner or shared editor). */
  canEdit: boolean
  /** The project-level AI freedom (own or server default) — what this
   * lecture uses while it has no setting of its own. */
  projectGenerationFreedom: number
}
