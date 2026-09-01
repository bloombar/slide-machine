/**
 * Seeing and disconnecting connected assistants (docs/MCP.md §5.3).
 *
 * Revocation is most of what OAuth buys a user over handing an assistant their
 * password: cancel one assistant, stay signed in everywhere else. That promise
 * is only real if there is somewhere to do it, which is what these two actions
 * are for.
 *
 * Both are `self`-scoped: a person may see and cut their own connections and
 * nobody else's. Not even an admin reaches through here — an assistant holding
 * a token is acting for one account, and taking that away is that account's
 * decision.
 */
import { z } from 'zod'
import { defineAction } from './define'
import { registerAction } from './dispatch'
import { self, type SelfAccess } from './access'
import { connectionsFor, disconnect } from '../oauth/store'
import { OAuthClientModel } from '../models/oauth-client'
import { SCOPE_DESCRIPTIONS, type Scope } from '../oauth/scopes'

/** One assistant currently holding a live token for this account. */
export interface McpConnection {
  clientId: string
  /** What the assistant called itself when it registered — a label, not a claim. */
  clientName: string
  /** What it was granted, in the words the consent screen used. */
  permissions: string[]
  connectedAt: string
}

export const mcpConnections = defineAction<
  Record<string, never>,
  McpConnection[],
  SelfAccess
>({
  name: 'mcp.connections',
  description:
    'Lists the AI assistants currently connected to this account, what each ' +
    'was allowed to do, and when it was connected.',
  access: self(),
  input: z.object({}).strict(),
  execute: async (_ctx, _input, { userId }) => {
    const connections = await connectionsFor(userId)
    const clients = await OAuthClientModel.find({
      clientId: { $in: connections.map(c => c.clientId) },
    })
    const nameOf = new Map(clients.map(c => [c.clientId, c.clientName]))

    return connections.map(connection => ({
      clientId: connection.clientId,
      clientName: nameOf.get(connection.clientId) ?? 'An unnamed assistant',
      permissions: connection.scopes.map(
        scope => SCOPE_DESCRIPTIONS[scope as Scope] ?? scope,
      ),
      connectedAt: connection.connectedAt.toISOString(),
    }))
  },
})

export const mcpDisconnect = defineAction<
  { clientId: string },
  { disconnected: number },
  SelfAccess
>({
  name: 'mcp.disconnect',
  description:
    'Disconnects one AI assistant from this account. Every token it holds ' +
    'stops working immediately; the account stays signed in everywhere else.',
  access: self(),
  input: z.object({ clientId: z.string().min(1) }),
  execute: async (_ctx, input, { userId }) => {
    // Every token this pair ever issued, not just the one last presented:
    // the user's intent is "this assistant stops having access".
    const disconnected = await disconnect(userId, input.clientId)
    return { disconnected }
  },
})

registerAction(mcpConnections)
registerAction(mcpDisconnect)
