/**
 * Web image search results (EDIT-1). The candidate images offered when an
 * instructor replaces a slide's picture: each comes from a permitted
 * source (Wikimedia, Openverse, Flickr) already carrying its attribution,
 * so choosing one records proper credit automatically (IMG-5).
 */
import type { ImageAttribution } from '../types/deck'

export interface ImageSearchCandidate {
  /** Projector-safe image URL; also stored as the slide's imageRef when chosen. */
  url: string
  /** Human title of the work, shown in the results grid. */
  title: string
  /** Originating source, e.g. 'wikimedia' | 'openverse' | 'flickr'. */
  source: string
  /** Source-agnostic credit, stored with the slide when chosen (IMG-5). */
  attribution?: ImageAttribution
  width?: number
  height?: number
}
