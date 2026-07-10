/**
 * ImageGenerationProvider — prompt in, generated image out (SPEC IMG-4 /
 * TECH-8). Optional, off-by-default enrichment source; results are always
 * labeled as AI-generated for provenance.
 */
export interface ImageGenerationRequest {
  prompt: string
  /** Optional size hint, e.g. "1024x768"; adapters map to provider options. */
  size?: string
}

export interface ImageGenerationResult {
  /** Raw bytes or a data/remote URL, depending on the adapter. */
  imageData: Uint8Array | string
  mimeType: string
  provenance: 'generated'
}

export interface ImageGenerationProvider {
  readonly name: string
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>
}
