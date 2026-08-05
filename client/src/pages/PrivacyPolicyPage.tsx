/**
 * "Privacy policy" — a static document page. The words live in
 * content/privacy.ts; this is only the route's entry point. The document is
 * built per render because it names the operator, which the server publishes
 * at runtime (OPERATOR_* — see content/document.ts).
 */
import StaticDocument from '../components/StaticDocument'
import { privacyDocument } from '../content/privacy'

export default function PrivacyPolicyPage() {
  return <StaticDocument doc={privacyDocument()} />
}
