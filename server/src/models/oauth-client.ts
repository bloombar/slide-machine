/**
 * An AI assistant that has introduced itself to this deployment (docs/MCP.md §5).
 *
 * These are created by **dynamic client registration** (RFC 7591) rather than
 * by an administrator: an assistant nobody pre-arranged posts its name and
 * redirect URIs and gets an id back. That is what makes "faculty use whichever
 * assistant they prefer" true instead of "whichever assistant the maintainers
 * added by hand" — but it also means anything can register, so registration
 * grants nothing on its own. A registered client with no user's consent can
 * reach exactly nothing; the consent screen is the real gate.
 *
 * Public clients (a desktop assistant, which cannot keep a secret) hold no
 * secret at all and are identified by PKCE. Confidential clients get one, and
 * only its hash is stored, exactly as session tokens are.
 */
import { Schema, model } from 'mongoose'

export interface OAuthClientDb {
  /** The `client_id` handed to the assistant. */
  clientId: string
  /** HMAC of the client secret; absent for a public client. */
  secretHash?: string
  /** What the consent screen calls it. Assistant-supplied, so never trusted
   * as anything but a label — it is shown escaped and never used to decide. */
  clientName?: string
  /** Where an authorization response may be sent. Matched exactly. */
  redirectUris: string[]
  /** The registration request, kept verbatim so the metadata endpoints can
   * echo back what the client registered rather than a reconstruction. */
  metadata: Record<string, unknown>
  createdAt: Date
}

const oauthClientSchema = new Schema<OAuthClientDb>({
  clientId: { type: String, required: true, unique: true },
  secretHash: { type: String },
  clientName: { type: String },
  redirectUris: { type: [String], required: true },
  metadata: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
})

export const OAuthClientModel = model<OAuthClientDb>(
  'OAuthClient',
  oauthClientSchema,
)
