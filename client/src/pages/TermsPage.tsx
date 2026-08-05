/**
 * "Terms & conditions" — a static document page. The words live in
 * content/terms.ts; this is only the route's entry point. The document is
 * built per render because it names the operator, which the server publishes
 * at runtime (OPERATOR_* — see content/document.ts).
 */
import StaticDocument from '../components/StaticDocument'
import { termsDocument } from '../content/terms'

export default function TermsPage() {
  return <StaticDocument doc={termsDocument()} />
}
