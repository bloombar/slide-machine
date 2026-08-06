/**
 * Outgoing mail. One place the app hands a message to, whatever the
 * deployment does with it (MAIL_PROVIDER):
 *
 *  - `smtp` relays through the SMTP_* settings (P-3: the credentials stay
 *    server-side and are never exposed to the client)
 *  - `log`  writes the message to the server log — dev and e2e, where there
 *    is no relay to talk to and the point is only that a send happened
 *  - `none` disables mail entirely
 *
 * Callers ask `mailerAvailable()` first and offer the feature only when it
 * says yes, so a misconfigured server hides a form rather than accepting a
 * message it cannot deliver. `sendMail` still refuses on its own — the check
 * is a courtesy to the user, not the guard.
 *
 * The transport is built once, on first send, so a server with no mail
 * configured never constructs one.
 */
import { appendFileSync } from 'node:fs'
import { createTransport, type Transporter } from 'nodemailer'
import { env } from '../config/env'

/** A message the app originates. Plain text only: everything the app sends
 * is correspondence, not marketing, and text needs no sanitizing pass. */
export interface OutgoingMail {
  to: string
  subject: string
  text: string
  /** Where a reply should go, when that is not the envelope sender — a
   * feedback message replies to whoever wrote it, not to the app. */
  replyTo?: string
}

/** Mail could not be sent because the server is not set up to send it. */
export class MailUnavailableError extends Error {
  constructor(message = 'Email is not configured on this server') {
    super(message)
    this.name = 'MailUnavailableError'
  }
}

/** The address mail is sent as. SMTP_USER is the fallback because most
 * relays require the sender to be the authenticated account. */
export const mailFrom = (): string | undefined => env.MAIL_FROM ?? env.SMTP_USER

/**
 * Whether a message handed to `sendMail` would actually go somewhere. SMTP
 * needs a host to relay through and an address to send as; the log transport
 * needs neither.
 */
export const mailerAvailable = (): boolean => {
  if (env.MAIL_PROVIDER === 'none') return false
  if (env.MAIL_PROVIDER === 'log') return true
  return Boolean(env.SMTP_HOST && mailFrom())
}

let transporter: Transporter | null = null

/** The SMTP transport, built on first use and reused after. Port 465 is
 * implicit TLS; everything else upgrades with STARTTLS, which is what the
 * common submission port (587) expects. */
const smtpTransport = (): Transporter => {
  if (!transporter) {
    const port = env.SMTP_PORT ?? 587
    transporter = createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
    })
  }
  return transporter
}

/** Drops CR/LF from a header value. Nodemailer encodes headers correctly on
 * its own, but these values can come from an unauthenticated form, and a
 * subject or reply-to that cannot carry a line break cannot smuggle a header
 * into the message however it is encoded. */
const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim()

/**
 * Sends a message, or throws MailUnavailableError when the server has no way
 * to. Delivery failures (a relay that rejects the message) surface as the
 * transport's own error.
 */
export const sendMail = async (mail: OutgoingMail): Promise<void> => {
  if (!mailerAvailable()) throw new MailUnavailableError()

  const message = {
    from: mailFrom(),
    to: mail.to,
    subject: oneLine(mail.subject),
    text: mail.text,
    ...(mail.replyTo ? { replyTo: oneLine(mail.replyTo) } : {}),
  }

  if (env.MAIL_PROVIDER === 'log') {
    // The whole message, so a developer reading the log sees exactly what a
    // configured server would have delivered.
    const rendered =
      `[mail] to=${message.to} subject=${message.subject}` +
      `${message.replyTo ? ` reply-to=${message.replyTo}` : ''}\n${message.text}`
    console.info(rendered)
    // The e2e run reads links out of this file, because a mailed token is
    // stored hashed and so cannot be recovered from the database. Best
    // effort: an unwritable path must not fail the send.
    if (env.MAIL_LOG_FILE) {
      try {
        appendFileSync(env.MAIL_LOG_FILE, `${rendered}\n---\n`)
      } catch (error) {
        console.warn('Could not append to MAIL_LOG_FILE:', error)
      }
    }
    return
  }

  await smtpTransport().sendMail(message)
}

/** Drops the cached transport, so a test (or a config reload) can build a
 * fresh one against changed settings. */
export const resetMailer = (): void => {
  transporter = null
}
