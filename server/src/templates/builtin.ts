/**
 * Built-in slide-style templates (TMPL-2/TMPL-3). Each carries the seven
 * conventional layouts with AI-facing descriptors (TMPL-6) that are
 * serialized into generation requests as the layout option set (GEN-6).
 * Stored as code, not DB documents — user-authored templates (TMPL-4)
 * will live in MongoDB later.
 */
import type { Layout, LayoutDescriptor, Template } from '@slide-machine/shared'

/** The seven conventional layouts shared by every built-in template. */
const standardLayouts = (): Layout[] => [
  {
    type: 'title',
    label: 'Title',
    purpose: 'Opening slide: the lecture or major-topic title, nothing else',
    slots: ['title', 'caption'],
    constraints: { maxBodyLength: 0, maxTitleWords: 8, maxCaptionWords: 14 },
    elementPositions: {},
  },
  {
    type: 'section',
    label: 'Section',
    purpose: 'A new section or subtopic heading within the lecture',
    slots: ['title'],
    constraints: { maxTitleWords: 8 },
    elementPositions: {},
  },
  {
    type: 'content',
    label: 'Content',
    purpose: 'General slide: a short title plus one paragraph of body text',
    slots: ['title', 'body'],
    constraints: { maxBodyLength: 400, maxTitleWords: 8, maxBodyWords: 60 },
    elementPositions: {},
  },
  {
    type: 'list',
    label: 'Bullet list',
    purpose: 'Use for 3-6 short parallel points',
    slots: ['title', 'bullets'],
    constraints: { maxBullets: 6, maxTitleWords: 8, maxBulletWords: 12 },
    elementPositions: {},
  },
  {
    type: 'image-heavy',
    label: 'Image',
    purpose: 'A striking image dominates; minimal caption text',
    slots: ['image', 'caption'],
    constraints: { imageRequired: true, maxCaptionWords: 14 },
    elementPositions: {},
  },
  {
    type: 'two-column',
    label: 'Two column',
    purpose: 'Text beside a supporting image',
    slots: ['title', 'body', 'image'],
    constraints: { maxBodyLength: 250, maxTitleWords: 8, maxBodyWords: 40 },
    elementPositions: {},
  },
  {
    type: 'quote',
    label: 'Quote',
    purpose: 'A single striking statement, question, or quotation',
    slots: ['body', 'caption'],
    constraints: { maxBodyLength: 200, maxBodyWords: 30, maxCaptionWords: 10 },
    elementPositions: {},
  },
]

const builtin = (
  id: string,
  name: string,
  theme: Record<string, unknown>,
): Template => ({
  id,
  ownerId: 'system',
  name,
  theme,
  layouts: standardLayouts(),
  visibility: 'public',
  voteScore: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
})

export const BUILTIN_TEMPLATES: Template[] = [
  builtin('classic', 'Classic', {
    background: '#fefce8',
    surface: '#ffffff',
    text: '#1c1917',
    muted: '#78716c',
    accent: '#b45309',
  }),
  builtin('midnight', 'Midnight', {
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f1f5f9',
    muted: '#94a3b8',
    accent: '#38bdf8',
  }),
  builtin('seminar', 'Seminar', {
    background: '#f0fdf4',
    surface: '#ffffff',
    text: '#14532d',
    muted: '#4d7c0f',
    accent: '#16a34a',
  }),
]

export const getBuiltinTemplate = (id: string): Template | undefined =>
  BUILTIN_TEMPLATES.find(t => t.id === id)

/** The AI-facing option set for a template (GEN-6). */
export const layoutDescriptors = (template: Template): LayoutDescriptor[] =>
  template.layouts.map(({ type, label, purpose, slots, constraints }) => ({
    type,
    label,
    purpose,
    slots,
    constraints,
  }))
