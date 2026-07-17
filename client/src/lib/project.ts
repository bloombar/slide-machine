/**
 * Display helpers for projects. A titleless project (e.g. the default one
 * created for a user's first lecture) keeps an empty title in the data;
 * the interface shows it under config.defaultProjectTitle.
 */
import type { Project } from '@slide-machine/shared'
import { config } from '../config'

export const projectTitle = (project: Pick<Project, 'title'>): string =>
  project.title.trim() || config.defaultProjectTitle
