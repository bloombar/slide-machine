/**
 * What each access policy hands `execute` once it has authorized the caller
 * (SPEC TECH-14).
 *
 * Every shape carries `userId`, which is what lets the per-file `requireUser`
 * helpers go away: an action that has been authorized always knows who is
 * acting, without asking again.
 *
 * The `acl` on these shapes is the ACL **as of authorization**. An action
 * that mutates access — a transfer, a visibility change — must re-resolve it
 * for its response rather than report this one, which by then describes the
 * lecture as it was before the change.
 */
import type { HydratedDocument } from 'mongoose'
import type { Template } from '@slide-machine/shared'
import type { ResolvedAcl } from '../../lib/access'
import type { DeckDb } from '../../models/deck'
import type { ProjectDb } from '../../models/project'
import type { SlideDb } from '../../models/slide'
import type { SeedAssetDb } from '../../models/seed-asset'
import type { TemplateDb } from '../../models/template'
import type { UserDb } from '../../models/user'
import type { RefineJobDb } from '../../models/refine-job'

/** The floor: an authorized policy always knows who is acting. */
export interface Signed {
  userId: string
}

export interface DeckAccess extends Signed {
  deck: HydratedDocument<DeckDb>
  acl: ResolvedAcl
}

/**
 * An allowlisted admin acting in place of the owner or an editor (ADMIN-5),
 * or null for an ordinary one. What the audit half of a settings change is
 * filed against.
 */
export interface AdminActor {
  id: string
  email: string
}

export interface DeckSettingsAccess extends DeckAccess {
  admin: AdminActor | null
}

/**
 * A lecture and the project it is being moved into (PROJ-3) — two resources,
 * both owned by the caller, so the action neither loads either one again.
 */
export interface DeckMoveAccess extends DeckAccess {
  project: HydratedDocument<ProjectDb>
}

export interface ProjectAccess extends Signed {
  project: HydratedDocument<ProjectDb>
  acl: ResolvedAcl
}

export interface ProjectSettingsAccess extends ProjectAccess {
  admin: AdminActor | null
}

/** A slide, plus the lecture whose ACL admitted the caller to it. */
export interface SlideAccess extends DeckAccess {
  slide: HydratedDocument<SlideDb>
}

/** A refine job, reached through the lecture it belongs to. */
export interface RefineJobAccess extends DeckAccess {
  job: HydratedDocument<RefineJobDb>
}

/**
 * A seed asset hangs off either a lecture or a project, and which one is not
 * known until the asset is loaded — so the level that authorized it is
 * reported here rather than assumed by the caller.
 */
export type SeedAssetLevel =
  | { kind: 'deck'; deck: HydratedDocument<DeckDb>; acl: ResolvedAcl }
  | { kind: 'project'; project: HydratedDocument<ProjectDb>; acl: ResolvedAcl }

export interface SeedAssetAccess extends Signed {
  asset: HydratedDocument<SeedAssetDb>
  level: SeedAssetLevel
}

/**
 * A template, plus its stored document — null for a built-in, which comes
 * from a file the deployment controls and cannot be edited.
 */
export interface TemplateAccess extends Signed {
  template: Template
  doc: HydratedDocument<TemplateDb> | null
}

/** A template the caller authored: always stored, never a built-in. */
export interface TemplateAuthorAccess extends TemplateAccess {
  doc: HydratedDocument<TemplateDb>
}

export interface SelfAccess extends Signed {
  user: HydratedDocument<UserDb>
}

/** Added by the connected-account combinators. */
export type WithGoogle<R> = R & { googleUser: HydratedDocument<UserDb> }
