/**
 * The privacy policy as this deployment names it. The words are in
 * `@slide-machine/shared` (the server renders them too); this binds them to
 * the operator the running client was told about.
 */
import { privacyDocument as build } from '@slide-machine/shared'
import type { StaticDocument } from './document'
import { resolveOperator } from './document'

export const privacyDocument = (operator = resolveOperator()): StaticDocument =>
  build(operator)
