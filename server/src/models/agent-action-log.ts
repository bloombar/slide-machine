/**
 * What an AI assistant did, on whose behalf (docs/MCP.md §6).
 *
 * Admin actions have had an immutable trail since ADMIN-7, on the principle
 * that admin power is broad but never silent. Agent power is narrower — ten
 * tools, none of them destructive — but it is exercised by a machine reading
 * material the application has never seen, which is the one way a properly
 * authorized request can still be one the instructor never wanted. Nothing
 * else in the system records that it happened: an agent's calls are ordinary
 * calls by the account that authorized them, deliberately, so by the time
 * anything downstream sees one there is no longer anything to notice.
 *
 * Append-only, like the admin log: rows are created here and read; no update
 * or delete path exists.
 *
 * **What is deliberately not here: the input.** Tracing which lecture an
 * assistant renamed needs the action and the lecture, not the words. Keeping
 * payloads would stand up a second copy of lecture content — student-adjacent
 * material under a different retention story than the deck it came from — to
 * answer a question the references already answer (§16, P-1/P-2).
 */
import { Schema, type Types } from 'mongoose'
import { ACTOR_CHANNELS, type ActorChannel } from '@slide-machine/shared'
import { defineModel } from './define-model'

/** How an attempt ended. */
export const AGENT_OUTCOMES = ['ok', 'refused', 'failed'] as const

export type AgentOutcome = (typeof AGENT_OUTCOMES)[number]

export interface AgentActionLogDb {
  /** The account the assistant was acting for — the one that consented. */
  userId: Types.ObjectId
  /** Which non-human channel this came through, for when there is more than
   * one (docs/MCP.md §3.4). Today always `agent`. */
  channel: ActorChannel
  /** The action name, e.g. `deck.rename`. Not the tool name: one tool composes
   * several actions, and what reached the data is the question. */
  action: string
  /**
   * `refused` is the interesting one — an assistant asking for something the
   * account may not have. It is separated from `failed` because they read
   * differently in a row of them: repeated refusals are a signal, repeated
   * failures are a bug.
   */
  outcome: AgentOutcome
  /** The typed dispatch error's class name, when one ended it. */
  errorName?: string
  /** Ties the actions of one tool call together; a single instruction from an
   * instructor can be several rows. */
  requestId: string
  projectId?: Types.ObjectId | null
  /** The names at the time: the row outlives what it describes. */
  projectName?: string
  deckId?: Types.ObjectId | null
  deckName?: string
  createdAt: Date
}

const agentActionLogSchema = new Schema<AgentActionLogDb>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    channel: { type: String, enum: ACTOR_CHANNELS, required: true },
    action: { type: String, required: true },
    outcome: { type: String, enum: AGENT_OUTCOMES, required: true },
    errorName: String,
    requestId: { type: String, required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    projectName: String,
    deckId: { type: Schema.Types.ObjectId, ref: 'Deck', default: null },
    deckName: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

// "What has an assistant been doing on my account" — the question an
// instructor or an operator actually asks, newest first.
agentActionLogSchema.index({ userId: 1, createdAt: -1 })
// "What touched this lecture", for tracing a change back to its cause.
agentActionLogSchema.index({ deckId: 1, createdAt: -1 })

// No soft-delete plugin, for the reason the cost ledger has none: a deleted
// lecture's history is still what happened, and a trail that disappears with
// the thing it describes cannot answer what reached it.
export const AgentActionLogModel = defineModel<AgentActionLogDb>(
  'AgentActionLog',
  agentActionLogSchema,
)
