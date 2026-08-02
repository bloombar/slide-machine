/**
 * Project settings as a full-width modal, mirroring the lecture
 * settings chrome, in tabs: General (the project's title, then seed notes
 * + seed material, which apply to every lecture, PROJ-1/SEED-1; plus an
 * owner Danger zone that deletes the whole project after confirmation)
 * and Privacy & Sharing —
 * the project's ACL, which every lecture without its own override
 * inherits (SHARE-1). Closes from the top-right icon or Escape.
 *
 * An allowlisted admin opening someone else's project edits it here too
 * (ADMIN-5, `adminOverride`): the same controls, saving through the same
 * actions, with a banner and an audit entry per change. Seed material is
 * the exception — uploading files into another user's project is content
 * authoring, not a settings edit, so that section stays with its owner.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { Project, Template } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { projectTitle, untitledProject } from '../lib/project'
import SeedNotesEditor from './SeedNotesEditor'
import SeedMaterial from './SeedMaterial'
import AdminEditNotice from './AdminEditNotice'
import ConfirmDialog from './ConfirmDialog'
import Modal from './Modal'
import AccessSettings from './AccessSettings'
import FreedomSlider from './FreedomSlider'
import LanguageSelect from './LanguageSelect'
import VoiceSelect from './VoiceSelect'
import { getTtsEnabled } from '../runtime-config'
import TemplatePicker from './TemplatePicker'

/** The tabs in order; each id also keys its label under
 * `deck.settings.tabs.<id>` — the same names the lecture settings use. */
const TABS = [{ id: 'general' }, { id: 'template' }, { id: 'sharing' }] as const

export type ProjectSettingsTabId = (typeof TABS)[number]['id']
type TabId = ProjectSettingsTabId

interface Props {
  project: Project
  /** Editors manage access too; only the owner can transfer ownership. */
  isOwner: boolean
  /** True when an admin has opened a project they cannot otherwise edit
   * (ADMIN-5): adds the audit banner and hides the seed-material uploads. */
  adminOverride?: boolean
  /** Which tab opens first (deep links, e.g. Share from the home kebab). */
  initialTab?: TabId
  onClose: () => void
  /** Fired after a successful save so the page keeps a fresh project. */
  onProjectChange: (project: Project) => void
  /** Fired after the project is deleted; the page leaves for home. */
  onDeleted: () => void
}

export default function ProjectSettingsModal({
  project,
  isOwner,
  adminOverride = false,
  initialTab = 'general',
  onClose,
  onProjectChange,
  onDeleted,
}: Props) {
  const { t } = useTranslation()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [tab, setTab] = useState<TabId>(initialTab)
  const [templates, setTemplates] = useState<Template[]>([])

  useEffect(() => {
    let cancelled = false
    dispatchAction<Template[]>('template.list')
      .then(list => {
        if (!cancelled) setTemplates(list)
      })
      .catch(() => {
        // Quiet failure: the section simply stays empty
      })
    return () => {
      cancelled = true
    }
  }, [])
  const closeRef = useRef<HTMLButtonElement>(null)

  // Editable project title. A project must keep a name — the server
  // rejects a blank one — so an emptied field is left unsaved and reverts
  // to the stored title on the next render. Only saved when it changed.
  const [titleDraft, setTitleDraft] = useState(project.title)
  const saveTitle = () => {
    const title = titleDraft.trim()
    if (!title || title === project.title.trim()) return
    dispatchAction<Project>('project.update', {
      projectId: project.id,
      title,
    })
      .then(onProjectChange)
      .catch(() => {
        // Quiet failure: the field reverts to the saved title on re-render
      })
  }

  const deleteProject = () => {
    dispatchAction('project.delete', { projectId: project.id })
      .then(() => {
        setConfirmingDelete(false)
        onDeleted()
      })
      .catch(() => {
        // Quiet failure: the project simply stays
        setConfirmingDelete(false)
      })
  }

  return (
    <Modal
      variant="sheet"
      ariaLabel={t('project.settings.title')}
      onClose={onClose}
      initialFocusRef={closeRef}
      escapeCapture={false}
      escapeIgnoreTyping
    >
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{t('project.settings.title')}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {t('project.settings.scope')}
          </p>
        </div>
        <button
          ref={closeRef}
          aria-label={t('deck.settings.close')}
          title={t('common.closeEsc')}
          onClick={onClose}
          className="rounded-md p-2 text-slate-500 hover:text-slate-900"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      {adminOverride && <AdminEditNotice entity="project" />}

      <div
        role="tablist"
        aria-label={t('deck.settings.sections')}
        className="mb-6 flex gap-1 border-b border-slate-200"
      >
        {TABS.map(tab_ => (
          <button
            key={tab_.id}
            role="tab"
            id={`project-tab-${tab_.id}`}
            aria-selected={tab === tab_.id}
            aria-controls={`project-panel-${tab_.id}`}
            tabIndex={tab === tab_.id ? 0 : -1}
            onClick={() => setTab(tab_.id)}
            className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium ${
              tab === tab_.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {t(`deck.settings.tabs.${tab_.id}`)}
          </button>
        ))}
      </div>

      {tab === 'template' && (
        <section
          role="tabpanel"
          id="project-panel-template"
          aria-labelledby="project-tab-template"
        >
          <h3 className="mb-2 text-lg font-semibold text-slate-700">
            {t('project.settings.templateHeading')}
          </h3>
          <p className="mb-4 text-sm text-slate-500">
            {t('project.settings.templateHint')}
          </p>
          <TemplatePicker
            templates={templates}
            value={project.templateId}
            onChange={templateId => {
              dispatchAction<Project>('project.switchTemplate', {
                projectId: project.id,
                templateId,
              })
                .then(onProjectChange)
                .catch(() => {
                  // Quiet failure: the picker stays on the saved value
                })
            }}
          />
        </section>
      )}

      {tab === 'sharing' && (
        <section
          role="tabpanel"
          id="project-panel-sharing"
          aria-labelledby="project-tab-sharing"
        >
          <AccessSettings
            entity="project"
            subject={{
              id: project.id,
              name: projectTitle(project),
              visibility: project.visibility,
            }}
            isOwner={isOwner}
            onChange={updated => onProjectChange(updated as Project)}
          />
        </section>
      )}

      {tab === 'general' && (
        <div
          role="tabpanel"
          id="project-panel-general"
          aria-labelledby="project-tab-general"
          className="flex flex-col gap-8"
        >
          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-700">
              {t('project.settings.titleHeading')}
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              {t('project.settings.titleHint')}
            </p>
            <input
              aria-label={t('project.settings.titleHeading')}
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              placeholder={untitledProject()}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-700">
              {t('seed.notesHeading')}
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              {t('project.settings.seedNotesHint')}
            </p>
            <SeedNotesEditor
              value={project.seedContext ?? ''}
              label={t('project.settings.seedNotesLabel')}
              placeholder={t('project.settings.seedNotesPlaceholder')}
              onSave={seedContext => {
                dispatchAction<Project>('project.update', {
                  projectId: project.id,
                  seedContext,
                })
                  .then(onProjectChange)
                  .catch(() => {
                    // Quiet failure: the next keystroke retries
                  })
              }}
            />
          </div>

          {!adminOverride && (
            <div>
              <h3 className="mb-2 text-lg font-semibold text-slate-700">
                {t('seed.materialHeading')}
              </h3>
              <p className="mb-3 text-sm text-slate-500">
                {t('project.settings.seedMaterialHint')}
              </p>
              <SeedMaterial projectId={project.id} />
            </div>
          )}

          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-700">
              {t('freedom.label')}
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              {t('project.settings.freedomHint')}
            </p>
            <FreedomSlider
              value={project.generationFreedom}
              inheritedValue={project.effectiveGenerationFreedom}
              onChange={generationFreedom => {
                dispatchAction<Project>('project.update', {
                  projectId: project.id,
                  generationFreedom,
                })
                  .then(onProjectChange)
                  .catch(() => {
                    // Quiet failure: the slider reverts on rerender
                  })
              }}
            />
          </div>

          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-700">
              {t('deck.settings.general.languageHeading')}
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              {t('project.settings.languageHint')}
            </p>
            <LanguageSelect
              value={project.language}
              defaultLabel={t('project.settings.languageInherit')}
              onChange={language => {
                dispatchAction<Project>('project.update', {
                  projectId: project.id,
                  language,
                })
                  .then(onProjectChange)
                  .catch(() => {
                    // Quiet failure: the select reverts on rerender
                  })
              }}
            />
          </div>
          {getTtsEnabled() && (
            <div>
              <h3 className="mb-2 text-lg font-semibold text-slate-700">
                {t('voice.label')}
              </h3>
              <p className="mb-3 text-sm text-slate-500">
                {t('project.settings.voiceHint')}
              </p>
              <VoiceSelect
                value={project.ttsVoice}
                defaultLabel={t('voice.systemDefault')}
                onChange={ttsVoice => {
                  dispatchAction<Project>('project.update', {
                    projectId: project.id,
                    ttsVoice,
                  })
                    .then(onProjectChange)
                    .catch(() => {
                      // Quiet failure: the select reverts on rerender
                    })
                }}
              />
            </div>
          )}
          {isOwner && (
            <div className="rounded-md border border-red-200 p-4">
              <h3 className="mb-2 text-lg font-semibold text-red-700">
                {t('common.dangerZone')}
              </h3>
              <p className="mb-3 text-sm text-slate-600">
                {t('project.settings.deleteHint')}
              </p>
              <button
                onClick={() => setConfirmingDelete(true)}
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                {t('project.delete.action')}
              </button>
            </div>
          )}
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={t('project.delete.title')}
          message={t('project.delete.message', {
            name: projectTitle(project),
          })}
          confirmLabel={t('common.delete')}
          onConfirm={deleteProject}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </Modal>
  )
}
