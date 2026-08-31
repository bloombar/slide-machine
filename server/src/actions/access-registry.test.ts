/**
 * The access completeness audit (SPEC TECH-14).
 *
 * That every action *has* a declaration is now the Action type's job: `access`
 * is required, so an action without one does not compile and CI never reaches
 * this file. What is left for a test is everything the type cannot say:
 *
 *   - a WEAKENED guard fails, because ACCESS_INDEX pins each action's declared
 *     resource and level. Changing `deckEditor` to `deckViewer` still
 *     type-checks; it shows up here as a one-line diff in a table a reviewer
 *     reads, rather than a detail buried in a handler;
 *   - an action that authorizes itself must say WHY, and be named in a short
 *     allowlist — so `custom` cannot quietly become the easy way out;
 *   - the index cannot drift: a name here that no longer exists fails too.
 *
 * Before any of this, an action with no check at all failed nothing — not a
 * test, not a type, not a lint — so a missing guard was indistinguishable from
 * a deliberate one.
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
 * Actions whose access rule is genuinely not one resource at one level, and
 * why. Four of eighty-seven. Each is a decision somebody wrote down rather than
 * an action nobody got to: the reason is required, published here, and a new
 * name cannot join without editing this list.
 */
const REASONS = {
  'deck.list':
    'admission differs by whether a project is named, and an admin may list a deleted project’s lectures (ADMIN-6); a per-row filter then decides what is returned',
  'project.get':
    'admission and response fidelity are the same decision — member, admin and public reader each get a different shape, and opening a deleted project is audited (ADMIN-6)',
  'deck.feed':
    'the Mongo filter IS the authorization — publicDeckFilter reimplements deck ACL resolution at query level, so there is no single resource to resolve',
  'social.search':
    'the Mongo filter IS the authorization — the same publicDeckFilter, applied to a search rather than a listing',
} as const

const CUSTOM_ALLOWED = new Set<string>(Object.keys(REASONS))

/**
 * How every migrated action is guarded. One row per action; the test pins
 * each against the policy the action actually declares.
 */
const ACCESS_INDEX: Record<string, AccessDescriptor> = {
  'deck.feed': {
    resource: 'none',
    level: 'open',
    custom: { reason: REASONS['deck.feed'] },
  },
  'deck.get': { resource: 'deck', level: 'view' },
  'deck.list': {
    resource: 'none',
    level: 'open',
    custom: { reason: REASONS['deck.list'] },
  },
  'project.get': {
    resource: 'none',
    level: 'open',
    custom: { reason: REASONS['project.get'] },
  },
  'social.search': {
    resource: 'none',
    level: 'open',
    custom: { reason: REASONS['social.search'] },
  },
  'deck.create': { resource: 'project', level: 'own' },
  'deck.delete': { resource: 'deck', level: 'own' },
  'deck.import': { resource: 'project', level: 'own' },
  'deck.transferOwnership': { resource: 'deck', level: 'own' },
  'deck.vote': { resource: 'deck', level: 'view' },
  'project.create': { resource: 'none', level: 'signedIn' },
  'project.delete': { resource: 'project', level: 'own' },
  'project.list': { resource: 'none', level: 'signedIn' },
  'project.transferOwnership': { resource: 'project', level: 'own' },
  'seedAsset.delete': { resource: 'seedAsset', level: 'edit' },
  'seedAsset.list': { resource: 'seedAsset', level: 'edit' },
  'seedAsset.update': { resource: 'seedAsset', level: 'edit' },
  'system.echo': { resource: 'none', level: 'open' },
  'template.delete': { resource: 'template', level: 'author' },
  'template.duplicate': { resource: 'template', level: 'readable' },
  'template.export': { resource: 'template', level: 'readable' },
  'template.get': { resource: 'template', level: 'readable' },
  // Creating a template from a file the caller supplies: there is no existing
  // resource to be authorized against, only a signed-in owner for the new one.
  'template.import': { resource: 'none', level: 'signedIn' },
  'template.list': { resource: 'none', level: 'signedIn' },
  'template.previewImage': { resource: 'none', level: 'signedIn' },
  'template.update': { resource: 'template', level: 'author' },
  'deck.rename': { resource: 'deck', level: 'settings' },
  'deck.resetAccess': { resource: 'deck', level: 'settings' },
  'deck.setAccess': { resource: 'deck', level: 'settings' },
  'deck.setGenerationFreedom': { resource: 'deck', level: 'settings' },
  'deck.setLanguage': { resource: 'deck', level: 'settings' },
  'deck.setRefineSettings': { resource: 'deck', level: 'settings' },
  'deck.setSeedNotes': { resource: 'deck', level: 'settings' },
  'deck.setStudyLabel': { resource: 'deck', level: 'settingsAdmin' },
  'deck.setTtsVoice': { resource: 'deck', level: 'settings' },
  'deck.share': { resource: 'deck', level: 'settings' },
  'deck.shares': { resource: 'deck', level: 'settingsView' },
  'deck.switchTemplate': { resource: 'deck', level: 'settings' },
  'deck.unshare': { resource: 'deck', level: 'settings' },
  'project.setAccess': { resource: 'project', level: 'settings' },
  'project.share': { resource: 'project', level: 'settings' },
  'project.shares': { resource: 'project', level: 'settingsView' },
  'project.switchTemplate': { resource: 'project', level: 'settings' },
  'project.unshare': { resource: 'project', level: 'settings' },
  'project.update': { resource: 'project', level: 'settings' },
  'billing.change': { resource: 'self', level: 'self' },
  'billing.changePreview': { resource: 'self', level: 'self' },
  'billing.checkout': { resource: 'self', level: 'self' },
  'billing.plans': { resource: 'none', level: 'open' },
  'billing.portal': { resource: 'self', level: 'self' },
  'billing.summary': { resource: 'self', level: 'self' },
  'user.deleteAccount': { resource: 'self', level: 'self' },
  'user.setAccountType': { resource: 'self', level: 'self' },
  'user.setCapWarnings': { resource: 'self', level: 'self' },
  'user.setLanguage': { resource: 'self', level: 'self' },
  'user.setLocale': { resource: 'self', level: 'self' },
  'user.setProfileVisibility': { resource: 'self', level: 'self' },
  'user.updateProfile': { resource: 'self', level: 'self' },
  'user.usage': { resource: 'self', level: 'self' },
  'export.delete': { resource: 'deck', level: 'edit' },
  'export.download': { resource: 'deck', level: 'edit' },
  'export.status': { resource: 'deck', level: 'edit' },
  'export.toDrive': {
    resource: 'deck',
    level: 'edit',
    capabilities: ['google-drive'],
  },
  'quiz.connectGoogle': { resource: 'self', level: 'self' },
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
  // Reads a presentation out of the caller's own Drive and makes a template
  // of it (TMPL-8). No template resource to guard — one is created — so the
  // gate is a signed-in caller with a Google connection.
  // The same import, reading the file out of the connected Drive instead of
  // an upload — so it needs the grant the upload route does not.
  'template.importFromDrive': {
    resource: 'none',
    level: 'signedIn',
    capabilities: ['google-drive'],
  },
  'template.importFromSlides': {
    resource: 'none',
    level: 'signedIn',
    capabilities: ['google-drive'],
  },
  // Browsing Drive for something to import: the first step of an import, so
  // the same grant and the same surface as the imports themselves.
  'drive.importables': {
    resource: 'none',
    level: 'signedIn',
    capabilities: ['google-drive'],
  },
  'drive.pickerToken': {
    resource: 'none',
    level: 'signedIn',
    capabilities: ['google-drive'],
  },
  // A lecture from a presentation (EXP-5). The lecture does not exist yet, so
  // what is authorized is the project it lands in — owner only, matching
  // deck.create and deck.import — plus the grant that reads the presentation.
  'deck.importFromSlides': {
    resource: 'project',
    level: 'own',
    capabilities: ['google-drive'],
  },
  'deck.applyTemplateUpdate': { resource: 'deck', level: 'edit' },
  'deck.diarize': { resource: 'deck', level: 'edit' },
  'deck.refine': { resource: 'deck', level: 'edit' },
  'deck.refineSlide': { resource: 'deck', level: 'edit' },
  'deck.splitSlide': { resource: 'deck', level: 'edit' },
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

const registered = () => listActions().filter(a => a.name !== 'test.hooks')

describe('access registry (TECH-14)', () => {
  it('registers every action exactly once', () => {
    const names = registered().map(a => a.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThan(0)
  })

  it('lists no action that is not registered', () => {
    const names = new Set(registered().map(a => a.name))
    const stale = Object.keys(ACCESS_INDEX).filter(n => !names.has(n))
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
})
