/**
 * The access completeness audit (SPEC TECH-14).
 *
 * Every registered action must declare how it is authorized. Until this
 * existed, an action with no check at all failed nothing — not a test, not a
 * type, not a lint — so a missing guard was indistinguishable from a
 * deliberate one. This makes both visible:
 *
 *   - a NEW action with no declaration fails, because it is in neither
 *     ACCESS_INDEX nor PENDING_MIGRATION;
 *   - a WEAKENED guard fails, because ACCESS_INDEX pins the declared resource
 *     and level, so changing `deckEditor` to `deckViewer` is a one-line diff
 *     in a table a reviewer reads rather than a detail buried in a handler;
 *   - an action that authorizes itself must say why, and be listed.
 *
 * PENDING_MIGRATION is the un-migrated remainder. It may only shrink: an
 * action that has already been given a policy cannot be re-added to it, so
 * the list cannot rot into a permanent exemption. When it empties, `access`
 * becomes required on the Action type and this file loses its last special
 * case.
 *
 * Scope: the action registry only. Routes that reach deck data outside the
 * action layer keep their own checks (see access/policy.ts) — a green run
 * here is not a statement about them.
 */
import { describe, it, expect } from 'vitest'
import '../actions/register-all'
import { listActions } from './dispatch'
import type { AccessDescriptor } from './access/policy'

/**
 * How every migrated action is guarded. One row per action; the test pins
 * each against the policy the action actually declares.
 */
const ACCESS_INDEX: Record<string, AccessDescriptor> = {
  'export.delete': { resource: 'deck', level: 'edit' },
  'export.download': { resource: 'deck', level: 'edit' },
  'export.status': { resource: 'deck', level: 'edit' },
  'export.toDrive': {
    resource: 'deck',
    level: 'edit',
    capabilities: ['google-drive'],
  },
  'quiz.connectGoogle': { resource: 'self', level: 'self' },
  'quiz.createFolder': {
    resource: 'none',
    level: 'signedIn',
    capabilities: ['google-drive'],
  },
  'quiz.delete': { resource: 'deck', level: 'edit' },
  'quiz.driveFolders': {
    resource: 'none',
    level: 'signedIn',
    capabilities: ['google-drive'],
  },
  'quiz.generate': {
    resource: 'deck',
    level: 'edit',
    capabilities: ['google-drive'],
  },
  'quiz.publish': {
    resource: 'deck',
    level: 'edit',
    capabilities: ['google-drive'],
  },
  'quiz.status': { resource: 'deck', level: 'edit' },
  'template.exportToDrive': {
    resource: 'template',
    level: 'readable',
    capabilities: ['google-drive'],
  },
  'deck.applyTemplateUpdate': { resource: 'deck', level: 'edit' },
  'deck.diarize': { resource: 'deck', level: 'edit' },
  'deck.refine': { resource: 'deck', level: 'edit' },
  'deck.refineSlide': { resource: 'deck', level: 'edit' },
  'deck.refineSlideTranscript': { resource: 'deck', level: 'edit' },
  'deck.refineStatus': { resource: 'refineJob', level: 'edit' },
  'deck.reformat': { resource: 'deck', level: 'edit' },
  'deck.reorderSlides': { resource: 'deck', level: 'edit' },
  'deck.templateUpdateStatus': { resource: 'deck', level: 'edit' },
  'session.phrase': { resource: 'deck', level: 'edit' },
  'slide.add': { resource: 'deck', level: 'edit' },
  'slide.delete': { resource: 'slide', level: 'edit' },
  'slide.editContent': { resource: 'slide', level: 'edit' },
  'slide.editDrawings': { resource: 'slide', level: 'edit' },
  'slide.editTranscript': { resource: 'slide', level: 'edit' },
  'slide.get': { resource: 'slide', level: 'edit' },
  'slide.refitLayout': { resource: 'slide', level: 'edit' },
  'slide.regenerateTranscript': { resource: 'slide', level: 'edit' },
  'slide.setLayout': { resource: 'slide', level: 'edit' },
}

/** Actions whose access rule is not one resource at one level. */
const CUSTOM_ALLOWED = new Set<string>([])

/**
 * Not yet migrated — still checking access inside `execute`. Shrinks to
 * nothing over the course of TECH-14; never grows.
 */
const PENDING_MIGRATION = new Set<string>([
  'billing.change',
  'billing.changePreview',
  'billing.checkout',
  'billing.plans',
  'billing.portal',
  'billing.summary',
  'deck.create',
  'deck.delete',
  'deck.feed',
  'deck.get',
  'deck.import',
  'deck.list',
  'deck.rename',
  'deck.resetAccess',
  'deck.setAccess',
  'deck.setGenerationFreedom',
  'deck.setLanguage',
  'deck.setRefineSettings',
  'deck.setSeedNotes',
  'deck.setTtsVoice',
  'deck.share',
  'deck.shares',
  'deck.switchTemplate',
  'deck.transferOwnership',
  'deck.unshare',
  'deck.vote',
  'project.create',
  'project.delete',
  'project.get',
  'project.list',
  'project.setAccess',
  'project.share',
  'project.shares',
  'project.switchTemplate',
  'project.transferOwnership',
  'project.unshare',
  'project.update',
  'seedAsset.delete',
  'seedAsset.list',
  'seedAsset.update',
  'social.search',
  'system.echo',
  'template.delete',
  'template.duplicate',
  'template.export',
  'template.get',
  'template.list',
  'template.previewImage',
  'template.update',
  'user.deleteAccount',
  'user.setCapWarnings',
  'user.setLanguage',
  'user.setLocale',
  'user.setProfileVisibility',
  'user.updateProfile',
  'user.usage',
])

const registered = () => listActions().filter(a => a.name !== 'test.hooks')

describe('access registry (TECH-14)', () => {
  it('registers every action exactly once', () => {
    const names = registered().map(a => a.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThan(0)
  })

  // The gate. A new action lands in neither list, so it fails here until
  // somebody states its rule.
  it('every action either declares access or is a known remainder', () => {
    const undeclared = registered()
      .filter(a => !a.access && !PENDING_MIGRATION.has(a.name))
      .map(a => a.name)
    expect(undeclared).toEqual([])
  })

  // The ratchet. Once migrated, an action can never return to the remainder.
  it('the migration remainder only shrinks', () => {
    const regressed = registered()
      .filter(a => a.access && PENDING_MIGRATION.has(a.name))
      .map(a => a.name)
    expect(regressed).toEqual([])
  })

  it('lists no action that is not registered', () => {
    const names = new Set(registered().map(a => a.name))
    const stale = [...PENDING_MIGRATION, ...Object.keys(ACCESS_INDEX)].filter(
      n => !names.has(n),
    )
    expect(stale).toEqual([])
  })

  it('declares the same rule the index records', () => {
    const declared = Object.fromEntries(
      registered()
        .filter(a => a.access)
        .map(a => [a.name, a.access!.descriptor]),
    )
    expect(declared).toEqual(ACCESS_INDEX)
  })

  // An action that authorizes itself is a decision, not an omission — so it
  // carries its reason and is named in one short list.
  it('every self-authorizing action gives a reason and is allowlisted', () => {
    for (const action of registered()) {
      const custom = action.access?.descriptor.custom
      if (!custom) continue
      expect(custom.reason.length).toBeGreaterThan(0)
      expect(CUSTOM_ALLOWED.has(action.name)).toBe(true)
    }
  })

  it('never declares both the policy and the legacy hook', () => {
    const both = registered()
      .filter(a => a.access && a.authorize)
      .map(a => a.name)
    expect(both).toEqual([])
  })
})
