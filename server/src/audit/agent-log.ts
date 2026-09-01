/**
 * The single write path into the agent action log (docs/MCP.md §6).
 *
 * Mirrors audit/log.ts, including its discipline: a failed trail write is
 * reported and swallowed, never raised. Losing a row costs an operator some
 * traceability; failing the request costs an instructor their edit — and an
 * assistant that could be made to break an account's edits by breaking its
 * logging would be a worse problem than the one this exists to catch.
 */
import type { EntityAttribution } from '../billing/attribution-resolve'
import {
  AgentActionLogModel,
  type AgentOutcome,
} from '../models/agent-action-log'
import type { ActorChannel } from '@slide-machine/shared'

/** One attempt, as the dispatcher saw it end. */
export interface AgentActionInput {
  userId: string
  channel: ActorChannel
  action: string
  outcome: AgentOutcome
  errorName?: string
  requestId: string
  /** What the action named, resolved by the dispatcher. Absent when the input
   * named nothing findable — the row still records who did what. */
  entity?: EntityAttribution
}

/** Appends one entry. Never throws. */
export const logAgentAction = async ({
  entity,
  ...entry
}: AgentActionInput): Promise<void> => {
  try {
    await AgentActionLogModel.create({
      ...entry,
      projectId: entity?.projectId ?? null,
      projectName: entity?.projectName,
      deckId: entity?.deckId ?? null,
      deckName: entity?.deckName,
    })
  } catch (error) {
    console.error('agent action log write failed', error)
  }
}
