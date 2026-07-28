/**
 * Project settings as a full-width modal, mirroring the lecture
 * settings chrome, in tabs: General (seed notes + seed material, which
 * apply to every lecture, PROJ-1/SEED-1; plus an owner Danger zone that
 * deletes the whole project after confirmation) and Privacy & Sharing —
 * the project's ACL, which every lecture without its own override
 * inherits (SHARE-1). Closes from the top-right icon or Escape.
 */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Project, Template } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { projectTitle } from '../lib/project'
import SeedNotesEditor from './SeedNotesEditor'
import SeedMaterial from './SeedMaterial'
import ConfirmDialog from './ConfirmDialog'
import Modal from './Modal'
import AccessSettings from './AccessSettings'
import FreedomSlider from './FreedomSlider'
import LanguageSelect from './LanguageSelect'
import VoiceSelect from './VoiceSelect'
import { getTtsEnabled } from '../runtime-config'
import TemplatePicker from './TemplatePicker'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'template', label: 'Design' },
  { id: 'sharing', label: 'Privacy & Sharing' },
] as const

export type ProjectSettingsTabId = (typeof TABS)[number]['id']
type TabId = ProjectSettingsTabId

interface Props {
  project: Project
  /** Editors manage access too; only the owner can transfer ownership. */
  isOwner: boolean
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
  initialTab = 'general',
  onClose,
  onProjectChange,
  onDeleted,
}: Props) {
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
      ariaLabel="Project settings"
      onClose={onClose}
      initialFocusRef={closeRef}
      escapeCapture={false}
      escapeIgnoreTyping
    >
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Project settings</h2>
          <p className="mt-1 text-sm text-slate-500">
            These settings apply across all lectures in this project (lectures
            can override some of them individually).
          </p>
        </div>
        <button
          ref={closeRef}
          aria-label="Close settings"
          title="Close (Esc)"
          onClick={onClose}
          className="rounded-md p-2 text-slate-500 hover:text-slate-900"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <div
        role="tablist"
        aria-label="Settings sections"
        className="mb-6 flex gap-1 border-b border-slate-200"
      >
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            id={`project-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`project-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {t.label}
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
            Default template
          </h3>
          <p className="mb-4 text-sm text-slate-500">
            New lectures in this project start with this template. Each lecture
            keeps its own and can switch any time in its settings.
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
              Seed notes
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              Background material that guides slide generation for every lecture
              in this project. Saved automatically.
            </p>
            <SeedNotesEditor
              value={project.seedContext ?? ''}
              label="Project seed notes"
              placeholder="Key topics, terminology, planned structure…"
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

          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-700">
              Seed material
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              Documents and photos scanned for background text and imagery,
              available to every lecture in this project.
            </p>
            <SeedMaterial projectId={project.id} />
          </div>

          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-700">
              AI freedom
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              How much the AI may add beyond what the speaker says. Lectures in
              this project inherit it unless they set their own.
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
              Language
            </h3>
            <p className="mb-3 text-sm text-slate-500">
              Speech recognition and generated slide text for lectures in this
              project, unless a lecture sets its own.
            </p>
            <LanguageSelect
              value={project.language}
              defaultLabel="your profile setting or browser language"
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
                Narration voice
              </h3>
              <p className="mb-3 text-sm text-slate-500">
                The voice used to read lectures in this project aloud, unless a
                lecture sets its own. It speaks in the project's language.
              </p>
              <VoiceSelect
                value={project.ttsVoice}
                defaultLabel="system default"
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
                Danger zone
              </h3>
              <p className="mb-3 text-sm text-slate-600">
                Deleting a project permanently removes all of its lectures,
                slides, and seed material. This cannot be undone.
              </p>
              <button
                onClick={() => setConfirmingDelete(true)}
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Delete project
              </button>
            </div>
          )}
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete project?"
          message={`"${project.title}" and all of its lectures, slides, and seed material will be permanently deleted.`}
          confirmLabel="Delete"
          onConfirm={deleteProject}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </Modal>
  )
}
