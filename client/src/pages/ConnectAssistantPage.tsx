/**
 * "Connecting an AI assistant" — a static document page. The words live in
 * content/assistants.ts; this is only the route's entry point.
 */
import StaticDocument from '../components/StaticDocument'
import { ASSISTANTS } from '../content/assistants'

export default function ConnectAssistantPage() {
  return <StaticDocument doc={ASSISTANTS} />
}
