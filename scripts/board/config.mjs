/**
 * Shared configuration for the project-board scripts (derive.mjs, sync.mjs).
 * Field/option IDs are intentionally NOT hard-coded here — sync.mjs discovers
 * them from the live project at runtime so option-id changes don't break it.
 */

// The GitHub Project and the repo its issues live in.
export const OWNER = 'bloombar'
export const PROJECT_NUMBER = 1
export const REPO = 'bloombar/slide-machine'

// Phases are carried by repo Milestones; the project's built-in Milestone
// field is what each phase tab filters on. Titles must match the milestones.
export const PHASES = [1, 2, 3, 4]
export const MILESTONE_TITLE = {
  1: 'Phase 1 — MVP',
  2: 'Phase 2 — Fuller',
  3: 'Phase 3 — Complete',
  4: 'Phase 4 — Future Work',
}
// Optional due dates seeded from the ROADMAP milestones (Phase 4 has none).
export const MILESTONE_DUE = {
  1: '2026-07-21',
  2: '2026-08-11',
  3: '2026-08-29',
}

// The Status single-select drives the board columns. These names must match
// the existing option names on the project's Status field exactly.
export const STATUSES = ['Backlog', 'In progress', 'Ready to review', 'Done']

// Per-family labels so the different types of task are distinguishable in the
// repo and on the board. Keyed by requirement family (AUTH, GEN, TECH, P, …).
export const FAMILY_LABEL = {
  AUTH: {
    name: 'area:auth',
    color: '1d76db',
    description: 'Accounts & authentication',
  },
  BILL: {
    name: 'area:billing',
    color: 'fbca04',
    description: 'Plans, billing & usage limits',
  },
  PROJ: {
    name: 'area:projects',
    color: '5319e7',
    description: 'Slide projects & lifecycle',
  },
  SEED: {
    name: 'area:seeding',
    color: '0052cc',
    description: 'Document & image seeding',
  },
  PREP: {
    name: 'area:preflight',
    color: 'b60205',
    description: 'Preflight concept extraction',
  },
  TMPL: {
    name: 'area:templates',
    color: 'd93f0b',
    description: 'Style template library',
  },
  CAP: {
    name: 'area:capture',
    color: '006b75',
    description: 'Live lecture capture / STT',
  },
  GEN: {
    name: 'area:generation',
    color: '0e8a16',
    description: 'Slide generation & enrichment',
  },
  IMG: {
    name: 'area:images',
    color: 'c2e0c6',
    description: 'Image enrichment & attribution',
  },
  PLAY: {
    name: 'area:playback',
    color: 'bfd4f2',
    description: 'Playback & narration',
  },
  EDIT: {
    name: 'area:editing',
    color: 'd4c5f9',
    description: 'Deck & slide editing',
  },
  SHARE: {
    name: 'area:sharing',
    color: 'c5def5',
    description: 'Viewer, permalinks & translation',
  },
  EXP: {
    name: 'area:export-import',
    color: 'fef2c0',
    description: 'Export / import & connected accounts',
  },
  SOC: {
    name: 'area:social',
    color: 'f9d0c4',
    description: 'Voting, browse & profiles',
  },
  TECH: {
    name: 'area:infrastructure',
    color: '555555',
    description: 'Technical stack & conventions',
  },
  P: {
    name: 'area:privacy',
    color: 'e99695',
    description: 'Privacy, security & compliance',
  },
  QUIZ: {
    name: 'area:quiz',
    color: '006b75',
    description: 'Quiz generation & publishing',
  },
  ADMIN: {
    name: 'area:admin',
    color: 'b60205',
    description: 'Administration & moderation',
  },
  EVAL: {
    name: 'area:evaluation',
    color: '1d76db',
    description: 'Research instrumentation & metrics',
  },
  FUTURE: {
    name: 'area:future',
    color: 'ededed',
    description: 'Future work (post-pilot)',
  },
}
export const familyLabel = family =>
  FAMILY_LABEL[family] || {
    name: `area:${family.toLowerCase()}`,
    color: 'ededed',
    description: '',
  }

// Hidden marker that keys an issue to a requirement id — the idempotency anchor.
export const marker = id => `<!-- sm-req: ${id} -->`
export const MARKER_RE = /<!--\s*sm-req:\s*([A-Za-z0-9.-]+)\s*-->/

/** GitHub heading-anchor slug (matches GitHub's own algorithm closely enough). */
export const anchorSlug = text =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

/** Deep link to a requirement's section in the SPEC on the given branch. */
export const specLink = (id, title, branch) =>
  `https://github.com/${REPO}/blob/${branch}/docs/SPEC.md#${anchorSlug(`${id} ${title}`)}`
