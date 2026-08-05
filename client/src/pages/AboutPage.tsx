/**
 * "About us" — a static document page. The words live in content/about.ts;
 * this is only the route's entry point.
 */
import StaticDocument from '../components/StaticDocument'
import { ABOUT } from '../content/about'

export default function AboutPage() {
  return <StaticDocument doc={ABOUT} />
}
