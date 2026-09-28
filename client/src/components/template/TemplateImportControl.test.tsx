/**
 * Unit tests for `TemplateImportControl` (TMPL-28/TMPL-29 round 2): the
 * shared "Import a design" button and dialog, and what only this control's
 * own state owns — whether the dialog is open, and which design (if any)
 * the report's "Open design" action points at.
 *
 * The panel it wraps (`TemplateImport`/`TemplateFileImport`) has its own
 * suites; this one drives the file half, which needs no Drive picker mock,
 * since the dialog wiring is the same either way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { Template } from '@slide-machine/shared'
import TemplateImportControl from './TemplateImportControl'

const dispatchAction = vi.fn()
vi.mock('../../api/actions', () => ({
  dispatchAction: (...args: unknown[]) => dispatchAction(...args),
}))

const yaml = 'version: 1\nkind: template\nname: Restored design\n'
const file = (name: string, text = yaml) =>
  new File([text], name, { type: 'application/x-yaml' })

/** Picks a file through the file half of the panel — the whole interaction
 * needed to drive an import, with no Drive picker to mock. */
const pickFile = (f: File) => {
  const input = screen.getByLabelText(/import a design file/i)
  fireEvent.change(input, { target: { files: [f] } })
}

/** Stands in for a design's own page, so a test can say what it was told
 * about where to return to. */
function Landed() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return <p>{`landed:${location.pathname} from:${from ?? ''}`}</p>
}

const renderControl = (onImported = vi.fn()) => {
  render(
    <MemoryRouter initialEntries={['/app/templates']}>
      <Routes>
        <Route
          path="/app/templates"
          element={<TemplateImportControl onImported={onImported} />}
        />
        <Route path="/t/:slug" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  )
  return onImported
}

const openDialog = () =>
  fireEvent.click(screen.getByRole('button', { name: /^Import a design$/i }))

beforeEach(() => {
  dispatchAction.mockReset()
})
afterEach(cleanup)

describe('TemplateImportControl: opening', () => {
  it('opens the dialog when the button is clicked', () => {
    renderControl()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    openDialog()

    expect(
      screen.getByRole('dialog', { name: 'Import a design' }),
    ).toBeInTheDocument()
  })
})

describe('TemplateImportControl: "Open design"', () => {
  it('appears once an import succeeds, and navigates to the design with state.from', async () => {
    const imported = {
      id: 't1',
      name: 'Restored design',
      permalinkSlug: 'restored-ab12',
    } as Template
    dispatchAction.mockResolvedValue(imported)
    const onImported = renderControl()
    openDialog()

    expect(
      screen.queryByRole('button', { name: 'Open design' }),
    ).not.toBeInTheDocument()

    pickFile(file('classic.template.yaml'))

    const open = await screen.findByRole('button', { name: 'Open design' })
    expect(onImported).toHaveBeenCalledWith(imported)

    fireEvent.click(open)

    expect(
      await screen.findByText('landed:/t/restored-ab12 from:/app/templates'),
    ).toBeInTheDocument()
  })

  it('is cleared when the dialog is reopened', async () => {
    const imported = {
      id: 't1',
      name: 'Restored design',
      permalinkSlug: 'restored-ab12',
    } as Template
    dispatchAction.mockResolvedValue(imported)
    renderControl()
    openDialog()
    pickFile(file('classic.template.yaml'))
    await screen.findByRole('button', { name: 'Open design' })

    // Closed (the dialog's own X) and opened again, with nothing imported
    // yet on this new visit.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    openDialog()

    expect(
      screen.queryByRole('button', { name: 'Open design' }),
    ).not.toBeInTheDocument()
  })

  it('is cleared the instant a second import attempt starts, before it is known to fail', async () => {
    const imported = {
      id: 't1',
      name: 'Restored design',
      permalinkSlug: 'restored-ab12',
    } as Template
    // The first pick succeeds; the second — without the dialog ever having
    // closed in between — is refused.
    dispatchAction.mockResolvedValueOnce(imported)
    renderControl()
    openDialog()
    pickFile(file('classic.template.yaml'))
    await screen.findByRole('button', { name: 'Open design' })

    dispatchAction.mockRejectedValueOnce(new Error('nope'))
    pickFile(file('bad.template.yaml', 'not a template'))

    // The stale button from the first, successful attempt must not still be
    // sitting next to whatever the second attempt turns out to say — it is
    // gone before that second attempt has even settled.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Open design' }),
      ).not.toBeInTheDocument(),
    )
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
