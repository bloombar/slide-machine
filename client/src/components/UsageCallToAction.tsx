/**
 * The closing sentence of every usage surface: what to do about a plan that is
 * running out. Which sentence it is follows the tier (BILL-4) — Free, Fresh
 * and Pro are offered an upgrade; Max is invited to get in touch, since no
 * larger plan exists (BILL-5).
 *
 * One component rather than the same <Trans> five times, because the sentence
 * carries links inside it and where they may point is a per-surface question
 * that is worth answering once. The messages hold two slots: <planLink>, which
 * a surface asks for only when it is not already the plan settings, and
 * <contactLink>, which is always a link — nothing else on these surfaces
 * offers a way to reach us, and an invitation with no address is not one.
 */
import { Trans } from 'react-i18next'
import { Link } from 'react-router'
import type { PlanTier } from '@slide-machine/shared'
import { callToActionFor } from '../lib/usage'
import { getFeedbackEnabled } from '../runtime-config'

/** Where "get in touch" goes. The form opens on "Something else": an account
 * asking for more room than Max is neither reporting a bug nor requesting a
 * feature, and starting it on the wrong question is a small insult. The cap
 * notification emails link to the same place (billing/cap-notifications). */
const CONTACT_PATH = '/feedback?kind=other'

const linkClass = 'font-medium text-indigo-600 hover:underline'

export default function UsageCallToAction({
  tier,
  linkToPlan = false,
  onFollow,
}: {
  tier: PlanTier
  /** Whether the plan wording links to the settings Plan tab. Off where the
   * surface is that tab, or already links to it on its own. */
  linkToPlan?: boolean
  /** Called when either link is followed — the footer badge uses it to close
   * its popover rather than leave it over the page it lands on. */
  onFollow?: () => void
}) {
  return (
    <Trans
      i18nKey={`usage.cta.${callToActionFor(tier)}`}
      components={{
        planLink: linkToPlan ? (
          <Link
            to="/app/settings?tab=plan"
            onClick={onFollow}
            className={linkClass}
          />
        ) : (
          <span />
        ),
        // A server with no mail transport, or nowhere to deliver to, has no
        // working form to send anyone to — so the words stay and the link
        // does not, the same rule the shell menu applies to its own entry.
        contactLink: getFeedbackEnabled() ? (
          <Link to={CONTACT_PATH} onClick={onFollow} className={linkClass} />
        ) : (
          <span />
        ),
      }}
    />
  )
}
