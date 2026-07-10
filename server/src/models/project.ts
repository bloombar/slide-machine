/**
 * Project model (SPEC §15 / PROJ-1). Settings override the owner's
 * projectDefaults per GEN-8/GEN-9.
 */
import { Schema, model, Types, type HydratedDocument } from 'mongoose'
import type { Project } from '@slide-machine/shared'

export interface ProjectDb extends Omit<
  Project,
  'id' | 'ownerId' | 'createdAt'
> {
  ownerId: Types.ObjectId
  createdAt: Date
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
    settings: {
      type: { manualSlideAdvance: Boolean, animatedTransitions: Boolean },
      default: undefined,
      _id: false,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

export const ProjectModel = model<ProjectDb>('Project', projectSchema)

export const toProjectDto = (doc: HydratedDocument<ProjectDb>): Project => ({
  id: doc._id.toString(),
  ownerId: doc.ownerId.toString(),
  title: doc.title,
  course: doc.course,
  description: doc.description,
  seedContext: doc.seedContext,
  settings: doc.settings,
  createdAt: doc.createdAt.toISOString(),
})
