/**
 * The client's half of the static documents. The documents themselves moved
 * to `@slide-machine/shared` when the server started rendering the two legal
 * ones into the HTML it serves; what stays here is the one piece that is
 * genuinely a browser concern — reading who the operator is from the runtime
 * config the server publishes.
 *
 * Re-exported alongside it so the pages and their tests keep one import for
 * "a static document and the operator naming it".
 */
import type { OperatorDetails } from '@slide-machine/shared'
import { withPlaceholders } from '@slide-machine/shared'
import { getOperator } from '../runtime-config'

export {
  OPERATOR_PLACEHOLDER,
  draftNotice,
  hasPlaceholders,
  withPlaceholders,
  type StaticDocument,
} from '@slide-machine/shared'

/**
 * The operator as this deployment describes itself: whatever the server was
 * given in `OPERATOR_*` (published through GET /api/config), with each field
 * it left blank falling back to its placeholder.
 */
export const resolveOperator = (
  configured: OperatorDetails = getOperator(),
): OperatorDetails => withPlaceholders(configured)
