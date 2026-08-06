/**
 * The two messages the app mails about an account (AUTH-3 / AUTH-4): the link
 * that proves someone owns an address, and the link that lets them set a new
 * password.
 *
 * Both are best-effort by design. A server with no relay configured still
 * registers accounts and still accepts "I forgot my password" — it simply has
 * no way to deliver the link, and saying so at the point of registration would
 * turn a deployment detail into a broken sign-up. Callers check
 * `mailerAvailable()` when they want to tell the user whether a link is coming.
 *
 * English only, following docs/I18N.md: the server does not localize.
 */
import { sendMail, mailerAvailable } from '../lib/mailer'
import { issueAuthToken } from './one-time-tokens'

/** A link back into the app, carrying the raw token as a query parameter. */
const linkTo = (origin: string, path: string, token: string): string =>
  `${origin}${path}?token=${encodeURIComponent(token)}`

/**
 * Mails a fresh verification link. Returns whether a message actually went
 * out, so a caller can tell the user "check your email" only when true.
 * Never throws: registration must not fail because mail is misconfigured.
 */
export const sendVerificationEmail = async (
  userId: string,
  email: string,
  displayName: string,
  origin: string,
): Promise<boolean> => {
  if (!mailerAvailable()) return false
  try {
    const token = await issueAuthToken(userId, 'verify-email')
    const link = linkTo(origin, '/verify-email', token)
    await sendMail({
      to: email,
      subject: 'Confirm your email address',
      text: [
        `Hi ${displayName},`,
        '',
        'Confirm this address to finish setting up your Slide Machine account:',
        '',
        link,
        '',
        'The link works for 24 hours. If you did not create an account, you',
        'can ignore this message — nothing will happen.',
      ].join('\n'),
    })
    return true
  } catch (error) {
    // Mail is a courtesy here, not the operation. The account exists either
    // way, and the user can ask for another link.
    console.warn('Could not send the verification email:', error)
    return false
  }
}

/**
 * Mails a password-reset link. Returns whether a message went out; the caller
 * deliberately does not pass that on to the user, because saying "no mail was
 * sent" would reveal whether the address has an account.
 */
export const sendPasswordResetEmail = async (
  userId: string,
  email: string,
  displayName: string,
  origin: string,
): Promise<boolean> => {
  if (!mailerAvailable()) return false
  try {
    const token = await issueAuthToken(userId, 'password-reset')
    const link = linkTo(origin, '/reset-password', token)
    await sendMail({
      to: email,
      subject: 'Reset your password',
      text: [
        `Hi ${displayName},`,
        '',
        'Use this link to choose a new password:',
        '',
        link,
        '',
        'The link works for one hour and only once. Using it signs you out',
        'everywhere else. If you did not ask for this, you can ignore this',
        'message — your password will not change.',
      ].join('\n'),
    })
    return true
  } catch (error) {
    console.warn('Could not send the password-reset email:', error)
    return false
  }
}
