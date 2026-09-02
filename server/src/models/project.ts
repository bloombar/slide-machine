/**
 * Project model (SPEC §15 / PROJ-1). Settings override the owner's
 * projectDefaults per GEN-8/GEN-9.
 */
import { Schema, Types, type HydratedDocument } from 'mongoose'
import { defineModel } from './define-model'
import type { Project, QuizGenerationOptions } from '@slide-machine/shared'
import { LOCALES } from '@slide-machine/shared'
import type { ResolvedAcl } from '../lib/access'
import { env } from '../config/env'
import { softDeletePlugin } from './plugins/soft-delete'
import { defaultTemplateId } from '../templates/builtin'

export interface ProjectDb extends Omit<
  Project,
  'id' | 'ownerId' | 'createdAt' | 'updatedAt' | 'viewers' | 'editors'
> {
  ownerId: Types.ObjectId
  viewers: string[]
  editors: string[]
  // Last-used quiz generation options, remembered so a new quiz in this
  // project pre-fills them (QUIZ-2). Server-only; not in the Project DTO.
  quizDefaults?: QuizGenerationOptions
  // The owner's chosen lecture order (PROJ-4), mirroring deck.slideOrder —
  // absent means "never arranged", which keeps the newest-first default.
  // A hint, not the source of truth: deck.list resolves it against the
  // project's actual (live) decks rather than trusting it outright, so a
  // lecture never in it and a stale id for one since deleted are both
  // handled there. Server-only; not in the Project DTO — deck.list already
  // returns lectures in this order, so nothing else needs to read it.
  lectureOrder?: string[]
  createdAt: Date
  updatedAt: Date
  /** Soft-delete tombstone (P-10); null/absent = live. */
  deletedAt?: Date | null
}

const projectSchema = new Schema<ProjectDb>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Blank allowed: a titleless "default" project shows a placeholder
    // name in the client (mirrors how untitled lectures are handled).
    title: { type: String, default: '', trim: true },
    course: String,
    description: String,
    seedContext: String,
    visibility: {
      type: String,
      enum: ['restricted', 'public'],
      default: 'public',
    },
    // Resolved when a project is created, so a deployment shipping its own
    // template set does not need this file changed (docs/TEMPLATES.md).
    templateId: { type: String, default: () => defaultTemplateId() },
    // Absent = server default; stored only when explicitly set
    generationFreedom: { type: Number, min: 1, max: 5, default: undefined },
    // Explicit lecturing language only; absent = inherit (owner profile,
    // then the speaker's browser)
    language: { type: String, enum: LOCALES, default: undefined },
    // Narration voice id (TTS_VOICES); absent = server default
    ttsVoice: { type: String, default: undefined },
    viewers: { type: [String], default: [] },
    editors: { type: [String], default: [] },
    settings: {
      type: { manualSlideAdvance: Boolean, animatedTransitions: Boolean },
      default: undefined,
      _id: false,
    },
    // Remembered quiz options (QUIZ-2); free-form, mirrors QuizGenerationOptions.
    quizDefaults: { type: Schema.Types.Mixed, default: undefined },
    // Absent = never arranged (PROJ-4); unlike deck.slideOrder this has no
    // `[]` default, so "no array" and "arranged, now empty" stay distinct —
    // though the latter cannot happen, since reordering requires at least
    // one lecture (see project.reorderLectures's input schema).
    lectureOrder: { type: [String], default: undefined },
  },
  // updatedAt is bumped by any save to the project's settings; project.list
  // combines it with the newest deck edit to rank projects by modification.
  { timestamps: true },
)

projectSchema.plugin(softDeletePlugin)

// Reachable from the action graph — the dispatcher resolves a lecture and
// project for cost attribution (BILL-7), which some specs re-evaluate.
export const ProjectModel = defineModel<ProjectDb>('Project', projectSchema)

/** A project's ACL is always its own (never inherited). */
export const projectAcl = (
  doc: Pick<ProjectDb, 'ownerId' | 'visibility' | 'viewers' | 'editors'>,
): ResolvedAcl => ({
  ownerId: doc.ownerId.toString(),
  visibility: doc.visibility,
  viewers: doc.viewers,
  editors: doc.editors,
  inherited: false,
})

export const toProjectDto = (doc: HydratedDocument<ProjectDb>): Project => ({
  id: doc._id.toString(),
  ownerId: doc.ownerId.toString(),
  title: doc.title,
  course: doc.course,
  description: doc.description,
  seedContext: doc.seedContext,
  visibility: doc.visibility,
  templateId: doc.templateId,
  generationFreedom: doc.generationFreedom,
  language: doc.language,
  ttsVoice: doc.ttsVoice,
  effectiveGenerationFreedom: doc.generationFreedom ?? env.GENERATION_FREEDOM,
  viewers: doc.viewers,
  editors: doc.editors,
  settings: doc.settings,
  createdAt: doc.createdAt.toISOString(),
  // Fall back for documents created before updatedAt was enabled.
  updatedAt: (doc.updatedAt ?? doc.createdAt).toISOString(),
})

/** The project as shown to non-owners: share lists stay with the owner. */
export const toSharedProjectDto = (
  doc: HydratedDocument<ProjectDb>,
): Project => {
  const dto = toProjectDto(doc)
  delete dto.viewers
  delete dto.editors
  return dto
}
