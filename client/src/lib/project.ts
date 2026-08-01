/**
 * Display helpers for projects. A titleless project (e.g. the default one
 * created for a user's first lecture) keeps an empty title in the data;
 * the interface shows it under the deployment's own placeholder name
 * (config.defaultProjectTitle) if one is set, else the translated
 * `project.untitled`.
 *
 * A plain function, not a constant, so a language switch is picked up —
 * callers must read it during render.
 */
import type { Project } from '@slide-machine/shared'
import { config } from '../config'
import { t } from '../i18n'

/** The placeholder shown in place of a project's missing title. */
export const untitledProject = (): string =>
  config.defaultProjectTitle ?? t('project.untitled')

export const projectTitle = (project: Pick<Project, 'title'>): string =>
  project.title.trim() || untitledProject()
