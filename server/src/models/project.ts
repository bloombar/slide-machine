/**
 * Project model (SPEC §15 / PROJ-1). Settings override the owner's
 * projectDefaults per GEN-8/GEN-9.
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import type { Project } from '@slide-machine/shared'
import { LOCALES } from '@slide-machine/shared'
import type { ResolvedAcl } from '../lib/access'
import { env } from '../config/env'

export interface ProjectDb extends Omit<
  Project,
  'id' | 'ownerId' | 'createdAt' | 'updatedAt' | 'viewers' | 'editors'
> {
  ownerId: Types.ObjectId
  viewers: string[]
  editors: string[]
  createdAt: Date
  updatedAt: Date
}

const projectSchema = new Schema<ProjectDb>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    course: String,
    description: String,
    seedContext: String,
    visibility: {
      type: String,
      enum: ['restricted', 'public'],
      default: 'public',
    },
    templateId: { type: String, default: 'classic' },
    // Absent = server default; stored only when explicitly set
    generationFreedom: { type: Number, min: 1, max: 5, default: undefined },
    // Explicit lecturing language only; absent = inherit (owner profile,
    // then the speaker's browser)
    language: { type: String, enum: LOCALES, default: undefined },
    viewers: { type: [String], default: [] },
    editors: { type: [String], default: [] },
    settings: {
      type: { manualSlideAdvance: Boolean, animatedTransitions: Boolean },
      default: undefined,
      _id: false,
    },
  },
  // updatedAt is bumped by any save to the project's settings; project.list
  // combines it with the newest deck edit to rank projects by modification.
  { timestamps: true },
)

export const ProjectModel = model<ProjectDb>('Project', projectSchema)

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
