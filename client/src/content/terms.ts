/**
 * The terms as this deployment names them. The words are in
 * `@slide-machine/shared` (the server renders them too); this binds them to
 * the operator the running client was told about.
 */
import { termsDocument as build } from '@slide-machine/shared'
import type { StaticDocument } from './document'
import { resolveOperator } from './document'

export const termsDocument = (operator = resolveOperator()): StaticDocument =>
  build(operator)
