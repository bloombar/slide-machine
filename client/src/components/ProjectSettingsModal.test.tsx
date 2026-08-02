/**
 * Tests for the Project settings "General" tab title field: it shows the
 * stored title, saves an edit through project.update on blur or Enter, and
 * leaves the project alone when the title is unchanged, blank, or the save
 * fails.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Project } from '@slide-machine/shared'
import { mockFetchRoutes } from '../test/fetch-mock'
import ProjectSettingsModal from './ProjectSettingsModal'

const baseProject: Project = {
  id: 'p1',
  ownerId: 'u1',
  title: 'Intro to Biology',
  templateId: 'classic',
  visibility: 'restricted',
  effectiveGenerationFreedom: 2,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
}

const renderModal = (over: Partial<Project> = {}) => {
  const onProjectChange = vi.fn()
  render(
    <MemoryRouter>
      <ProjectSettingsModal
        project={{ ...baseProject, ...over }}
        isOwner
        onClose={vi.fn()}
        onProjectChange={onProjectChange}
        onDeleted={vi.fn()}
      />
    </MemoryRouter>,
  )
  return { onProjectChange }
}

afterEach(cleanup)

describe('ProjectSettingsModal — project title', () => {
  it('shows the current title and saves an edit via project.update', async () => {
    const renamed = { ...baseProject, title: 'Intro to Cell Biology' }
    const { fetchMock } = mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.update': () => ({ status: 200, body: renamed }),
    })
    const { onProjectChange } = renderModal()

    const input = screen.getByRole('textbox', { name: 'Project title' })
    expect(input).toHaveValue('Intro to Biology')
    fireEvent.change(input, { target: { value: 'Intro to Cell Biology' } })
    fireEvent.blur(input)

    await waitFor(() => expect(onProjectChange).toHaveBeenCalledWith(renamed))
    // The trimmed title rides along with the project id
    const body = JSON.parse(
      (fetchMock.mock.calls.find(([url]) =>
        String(url).includes('project.update'),
      )?.[1] as RequestInit)!.body as string,
    )
    expect(body).toMatchObject({
      projectId: 'p1',
      title: 'Intro to Cell Biology',
    })
  })

  it('is the first field on the General tab', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal()
    const panel = screen.getByRole('tabpanel', { name: 'General' })
    const headings = Array.from(
      panel.querySelectorAll('h3'),
      h => h.textContent,
    )
    expect(headings[0]).toBe('Project title')
  })

  it('saves on Enter as well as blur', async () => {
    const renamed = { ...baseProject, title: 'Renamed' }
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.update': () => ({ status: 200, body: renamed }),
    })
    const { onProjectChange } = renderModal()

    const input = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Project title',
    })
    input.focus()
    fireEvent.change(input, { target: { value: 'Renamed' } })
    // Enter blurs the field, which triggers the save
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onProjectChange).toHaveBeenCalledWith(renamed))
  })

  it('trims surrounding whitespace before saving', async () => {
    const renamed = { ...baseProject, title: 'Trimmed' }
    const { fetchMock } = mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.update': () => ({ status: 200, body: renamed }),
    })
    const { onProjectChange } = renderModal()

    const input = screen.getByRole('textbox', { name: 'Project title' })
    fireEvent.change(input, { target: { value: '  Trimmed  ' } })
    fireEvent.blur(input)

    await waitFor(() => expect(onProjectChange).toHaveBeenCalledWith(renamed))
    const body = JSON.parse(
      (fetchMock.mock.calls.find(([url]) =>
        String(url).includes('project.update'),
      )?.[1] as RequestInit)!.body as string,
    )
    expect(body.title).toBe('Trimmed')
  })

  it('does not save when the title is unchanged', () => {
    const { fetchMock } = mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.update': () => ({ status: 500, body: {} }),
    })
    const { onProjectChange } = renderModal()

    fireEvent.blur(screen.getByRole('textbox', { name: 'Project title' }))
    expect(onProjectChange).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('project.update'),
      expect.anything(),
    )
  })

  it('does not save a blank title — the server requires a name', () => {
    const { fetchMock } = mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.update': () => ({ status: 500, body: {} }),
    })
    const { onProjectChange } = renderModal()

    const input = screen.getByRole('textbox', { name: 'Project title' })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)

    expect(onProjectChange).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('project.update'),
      expect.anything(),
    )
  })

  it('shows the untitled placeholder when the project has no title', () => {
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
    })
    renderModal({ title: '' })

    const input = screen.getByRole('textbox', { name: 'Project title' })
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', 'Default project')
  })

  it('quietly ignores a failed rename', async () => {
    const { fetchMock } = mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.update': () => ({ status: 500, body: {} }),
    })
    const { onProjectChange } = renderModal()

    const input = screen.getByRole('textbox', { name: 'Project title' })
    fireEvent.change(input, { target: { value: 'Doomed rename' } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('project.update'),
        expect.anything(),
      ),
    )
    expect(onProjectChange).not.toHaveBeenCalled()
  })

  it('lets an admin editing another owner’s project rename it', async () => {
    const renamed = { ...baseProject, title: 'Admin renamed' }
    mockFetchRoutes({
      '/api/actions/template.list': () => ({ status: 200, body: [] }),
      '/api/actions/project.update': () => ({ status: 200, body: renamed }),
    })
    const onProjectChange = vi.fn()
    render(
      <MemoryRouter>
        <ProjectSettingsModal
          project={baseProject}
          isOwner={false}
          adminOverride
          onClose={vi.fn()}
          onProjectChange={onProjectChange}
          onDeleted={vi.fn()}
        />
      </MemoryRouter>,
    )

    const input = screen.getByRole('textbox', { name: 'Project title' })
    fireEvent.change(input, { target: { value: 'Admin renamed' } })
    fireEvent.blur(input)
    await waitFor(() => expect(onProjectChange).toHaveBeenCalledWith(renamed))
  })
})
