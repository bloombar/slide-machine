/**
 * Static pages — About, Privacy, Terms — as content documents rather than
 * components: a heading, a date where one matters, and a Markdown body.
 *
 * They are **English only**, deliberately, the same call docs/I18N.md records
 * for the admin console. TECH-12 localizes the application's chrome; these are
 * documents, and a machine translation of a privacy policy or a set of terms
 * would be a legal statement nobody has read. A translated edition can be
 * added later as another document without touching the pages that render one.
 *
 * Keeping the prose out of .tsx also keeps it editable by whoever owns the
 * words — the body is Markdown, and nothing in it is code.
 *
 * The two legal documents are **built per render** from the operator details
 * the server publishes, so who is running the deployment is configuration
 * rather than source (see `resolveOperator` below).
 */
import type { OperatorDetails } from '@slide-machine/shared'
import { getOperator } from '../runtime-config'

export interface StaticDocument {
  /** The page's heading. */
  title: string
  /** One line under the heading saying what the document is for. */
  summary: string
  /** When the text last changed. Legal documents say so; About does not. */
  updated?: string
  /** The document itself, as Markdown. `##` is its top level — the title
   * above is the page's only `h1`. */
  body: string
}

/**
 * What the documents say where a deployment has not said who runs it. Square
 * brackets, so an unconfigured page reads as the draft it is rather than as a
 * policy with a suspiciously vague party to it.
 */
export const OPERATOR_PLACEHOLDER: OperatorDetails = {
  /** The legal entity behind the service. */
  name: '[Operator legal name]',
  /** Whose law governs the terms, and where disputes are heard. */
  jurisdiction: '[State / Country]',
  /** Where privacy and legal correspondence should go. This is not the
   * feedback address — that one is server-side only (FEEDBACK_EMAIL). */
  contactEmail: '[legal@example.com]',
  /** Postal address, where a policy is expected to give one. */
  postalAddress: '[Street, City, Postal code, Country]',
}

/**
 * The operator as this deployment describes itself: whatever the server was
 * given in `OPERATOR_*` (published through GET /api/config), with each field
 * it left blank falling back to its placeholder. Per field rather than all or
 * nothing — a deployment that has a name and an address but has not settled
 * on a jurisdiction should show the two it has.
 */
export const resolveOperator = (
  configured: OperatorDetails = getOperator(),
): OperatorDetails => ({
  name: configured.name.trim() || OPERATOR_PLACEHOLDER.name,
  jurisdiction:
    configured.jurisdiction.trim() || OPERATOR_PLACEHOLDER.jurisdiction,
  contactEmail:
    configured.contactEmail.trim() || OPERATOR_PLACEHOLDER.contactEmail,
  postalAddress:
    configured.postalAddress.trim() || OPERATOR_PLACEHOLDER.postalAddress,
})

/** Whether any detail is still a placeholder, which is what makes a document
 * a draft in the sense its banner means. */
export const hasPlaceholders = (operator: OperatorDetails): boolean =>
  Object.entries(OPERATOR_PLACEHOLDER).some(
    ([field, placeholder]) =>
      operator[field as keyof OperatorDetails] === placeholder,
  )

/**
 * The notice at the top of a legal document. It always says the text is
 * pending review; it mentions the square brackets only while there are still
 * some to explain.
 */
export const draftNotice = (operator: OperatorDetails): string => {
  const brackets = hasPlaceholders(operator)
    ? ' Passages in square brackets are details of the operator that have yet' +
      ' to be filled in.'
    : ''
  return `> **Draft.** This text describes what the service does today and is\n> pending legal review.${brackets}`
}
