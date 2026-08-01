/**
 * Compiles a mongoose model, reusing one already registered under that name.
 *
 * Mongoose keeps a process-global model registry, while several specs call
 * `vi.resetModules()` to re-evaluate a module graph under different
 * configuration (which provider is selected, whether OAuth is configured).
 * A model module caught in such a graph is evaluated twice but registers into
 * the same registry, and a plain `model()` call throws OverwriteModelError on
 * the second pass.
 *
 * Most models are only reachable from routes and actions that no spec
 * re-evaluates, so they call `model()` directly. Use this for models the
 * **action pipeline** reaches — an action's `meter` hook pulls in the whole
 * billing layer, which is how usage and subscription ended up here.
 */
import mongoose, { type Model, type Schema } from 'mongoose'

export const defineModel = <T>(name: string, schema: Schema<T>): Model<T> =>
  (mongoose.models[name] as Model<T> | undefined) ??
  mongoose.model<T>(name, schema)
