/**
 * Social-layer data models (SPEC §11, §15).
 */
export interface Vote {
  id: string
  userId: string
  targetType: 'deck' | 'template'
  targetId: string
  value: 1 | -1
}
