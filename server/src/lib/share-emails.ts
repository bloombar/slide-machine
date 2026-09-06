/**
 * The message someone gets when a lecture or project is shared with them
 * (SHARE-3). One message with two endings: an existing account is told the
 * lecture is waiting for them, and an address with no account is told to
 * sign up and **confirm this address** — which is the step that actually
 * grants it (lib/share-invites.ts), so the message names that step rather
 * than sending someone to a link that will not open yet.
 *
 * Best-effort, like every other message the app sends: a server with no
 * relay configured still shares, it simply cannot say so by email. Failures
 * are logged and swallowed — a share that succeeded must not report itself
 * as failed because a relay was down.
 *
 * English only, following docs/I18N.md: the server does not localize.
 */
import type { ShareRole } from '@slide-machine/shared'
import { UserModel } from '../models/user'
import { emailVerified } from '../auth/verified'
import { createRateLimiter } from './rate-limit'
import { sendMail, mailerAvailable } from './mailer'

/**
 * How many share notifications one account can cause per hour.
 *
 * Generous for the case this exists for — sharing a lecture with a seminar
 * group, one address at a time — and low enough that the relay cannot be
 * turned into a bulk sender by a script driving `deck.share` in a loop. In
 * memory, so it is a nuisance guard rather than a quota (lib/rate-limit.ts).
 */
const shareMailLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60 * 60 * 1000,
})

/** Forgets every window — for tests. */
export const resetShareMailLimit = (): void => shareMailLimiter.reset()

/** What was shared, in the words the message uses for it. */
export type SharedResourceKind = 'lecture' | 'project'

export interface ShareNotification {
  /** The recipient's address. */
  to: string
  /** Their display name, when they already have an account. */
  recipientName?: string
  /** Who did the sharing, as the recipient would recognise them. */
  sharerName: string
  kind: SharedResourceKind
  /** Title of the lecture or project. */
  title: string
  /** Absolute link to the shared thing — the point of the message. */
  link: string
  role: ShareRole
  /** False when the address has no account yet, which changes the ending. */
  hasAccount: boolean
}

/** What the role lets them do, said plainly rather than named. */
const roleLine = (role: ShareRole, kind: SharedResourceKind): string =>
  role === 'editor'
    ? `You can view and edit this ${kind}.`
    : `You can view this ${kind}.`

/** The message body, built separately from the sending so it can be read
 * back in tests without a relay. */
export const shareEmailText = (notice: ShareNotification): string =>
  [
    notice.recipientName ? `Hi ${notice.recipientName},` : 'Hi,',
    '',
    `${notice.sharerName} shared a ${notice.kind} with you on Slide Machine:`,
    '',
    notice.title,
    notice.link,
    '',
    roleLine(notice.role, notice.kind),
    ...(notice.hasAccount
      ? []
      : [
          '',
          'You do not have a Slide Machine account yet. Create one with this',
          `email address (${notice.to}), then confirm the address from the`,
          `email we send you — that is what opens the ${notice.kind} to you.`,
        ]),
  ].join('\n')

/** The subject line: who shared what, so an inbox list is enough to tell. */
export const shareEmailSubject = (notice: ShareNotification): string =>
  `${notice.sharerName} shared a ${notice.kind} with you: ${notice.title}`

/**
 * Mails the notification. Returns whether a message actually went out, so a
 * caller can say "we let them know" only when true. Never throws.
 */
export const sendShareEmail = async (
  notice: ShareNotification,
): Promise<boolean> => {
  if (!mailerAvailable()) return false
  try {
    await sendMail({
      to: notice.to,
      subject: shareEmailSubject(notice),
      text: shareEmailText(notice),
    })
    return true
  } catch (error) {
    // The share itself succeeded; the message is a courtesy on top of it.
    console.warn('Could not send the share notification:', error)
    return false
  }
}

/**
 * Sends the notification for one share, working out for itself who shared
 * and where the link points. Returns whether a message went out.
 *
 * Two guards stand between an account and the deployment's relay, because
 * this is the one message whose subject and body carry text the sender
 * chose — their display name and the lecture's title. An unconfirmed
 * account cannot send one at all (AUTH-3 already lets it share; what it may
 * not do is make the server mail strangers on its behalf), and a confirmed
 * one is capped per hour. Neither refuses the share itself: the grant is
 * saved either way, and only the announcement is withheld.
 *
 * Awaited by its callers rather than started and forgotten, unlike the
 * verification mail at sign-up: this runs inside a settings dialog where a
 * slow relay costs a moment, not a broken registration, and a share that
 * silently notified nobody is the failure this requirement exists to
 * prevent. It still cannot fail the share — every path here returns false
 * instead of throwing.
 *
 * Without an origin (background work, seeding) there is no absolute link to
 * put in the message, and a notification without the link is not worth
 * sending, so nothing goes out.
 */
export const notifyShare = async (
  ctx: { userId?: string; origin?: string },
  share: {
    to: string
    recipientName?: string
    kind: SharedResourceKind
    title: string
    /** App-relative path of the shared thing, e.g. `/d/some-slug`. */
    path: string
    role: ShareRole
    hasAccount: boolean
  },
): Promise<boolean> => {
  if (!ctx.origin || !mailerAvailable() || !ctx.userId) return false
  try {
    if (!(await emailVerified(ctx.userId))) return false
    if (!shareMailLimiter.take(ctx.userId)) {
      console.warn('Share notification rate limit reached for', ctx.userId)
      return false
    }
    const sharer = await UserModel.findById(ctx.userId).catch(() => null)
    return await sendShareEmail({
      ...share,
      sharerName: sharer?.displayName ?? 'Someone',
      link: `${ctx.origin}${share.path}`,
    })
  } catch (error) {
    console.warn('Could not send the share notification:', error)
    return false
  }
}
