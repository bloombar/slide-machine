/**
 * The generation event shape (GEN-1/GEN-8): how slide updates reach the
 * client, whether from the live pipeline, a simulated session, or a
 * future streamed transport. Defined early per ROADMAP §5.1 — this is
 * the seam between the generation pipeline and the renderer.
 */
import type { Locale } from '../types/locale'
import type { Deck, Slide, SlideTranslationEntry } from '../types/deck'
import type { Template } from '../types/template'
import type { VoiceCommand } from '../types/voice-commands'

export type SlideEventKind = 'slide.new' | 'slide.update' | 'none' | 'command'

/** One generation step's outcome. `none` = filler speech, nothing
 * changed. `command` = the AI recognized the phrase as a CAP-4 voice
 * command (feature-flagged); the client executes it like a wake-worded
 * command and nothing persists. */
export interface SlideEvent {
  kind: SlideEventKind
  slide?: Slide
  /** Set when kind is 'command'. */
  command?: VoiceCommand
  /** An AI-proposed lecture title was just saved (untitled decks only). */
  deckTitle?: string
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
  /** The project's own language setting, so the client can resolve the
   * lecture language live (deck ?? this ?? viewer profile ?? browser)
   * even as settings change mid-session. */
  projectLanguage?: Locale
  /** The project's own narration-voice setting, so a lecture with no voice of
   * its own shows what it inherits. */
  projectTtsVoice?: string
  /** Ids of slides that have playable retained lecture audio (a timed
   * transcript segment belonging to a still-retained recording). Populated
   * only for editors; drives the per-slide "Play original audio" option. */
  audioSlideIds?: string[]
  /** The lecture's owner (SOC-4 link target) and its project (header link). */
  owner: { id: string; displayName: string }
  project: { id: string; title: string }
  /** The requesting user's vote on this lecture: up (1), down (-1), none (0)
   * (SOC-1). */
  myVote: 1 | -1 | 0
  /** Up- and down-vote counts for this lecture (SOC-1), shown side by side in
   * the viewer's vote control. */
  voteUp: number
  voteDown: number
}

/**
 * A deck's slide content in one locale (SHARE-2), returned by the viewer's
 * translate endpoint. `perSlide` is keyed by slide id and is empty when the
 * requested locale is the deck's own — there is nothing to translate, and the
 * viewer renders the authored text.
 */
export interface DeckTranslationResponse {
  /** The locale the content was translated into. */
  locale: Locale
  /** The deck's own language — what "Original" means for this deck. */
  source: Locale
  perSlide: Record<string, SlideTranslationEntry>
}
