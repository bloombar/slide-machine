/**
 * Importing a template from an exported file (EXP-3), from the instructor's
 * side.
 *
 * Two things carry this control: the file's text has to reach the server
 * unaltered, and a refusal has to say what is wrong with the file. The same
 * design kept in Drive arrives by link instead, so those cases live with the
 * field that reads links (TemplateImport). A template
 * import substitutes nothing, so "it failed" would leave the instructor with a
 * file they cannot fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { Template } from '@slide-machine/shared'
import TemplateFileImport from './TemplateFileImport'
import { ApiError } from '../../api/http'

const dispatchAction = vi.fn()
vi.mock('../../api/actions', () => ({
  dispatchAction: (...args: unknown[]) => dispatchAction(...args),
}))

const template = { id: 't1', name: 'Restored design' } as Template

const yaml = 'version: 1\nkind: template\nname: Restored design\n'

/** A picked file, as the input hands one over. */
const file = (text = yaml) =>
  new File([text], 'classic.template.yaml', { type: 'application/x-yaml' })

/** Picks a file, which is the whole interaction. */
const pick = (f: File) => {
  const input = screen.getByLabelText(/import a design file/i)
  fireEvent.change(input, { target: { files: [f] } })
}

beforeEach(() => {
  dispatchAction.mockReset()
  dispatchAction.mockResolvedValue(template)
})

describe('picking a template file', () => {
  it('sends what the file says, so the server sees the export verbatim', async () => {
    render(<TemplateFileImport onImported={vi.fn()} />)
    pick(file())

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith('template.import', {
        content: yaml,
      }),
    )
  })

  it('hands the new template back so it can be worn straight away', async () => {
    const onImported = vi.fn()
    render(<TemplateFileImport onImported={onImported} />)
    pick(file())

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(template))
  })

  it('does nothing at all until a file is picked', () => {
    render(<TemplateFileImport onImported={vi.fn()} />)
    expect(dispatchAction).not.toHaveBeenCalled()
  })
})

describe('when the file will not do', () => {
  it('says what is wrong with it, which is what makes it fixable', async () => {
    // A template import substitutes nothing (EXP-3), so the list of problems
    // is the only route back to a file that imports
    dispatchAction.mockRejectedValue(
      new ApiError(400, 'validation', 'Invalid', [
        'layouts.0.slots: required',
        'theme: expected object',
      ]),
    )
    render(<TemplateFileImport onImported={vi.fn()} />)
    pick(file('nonsense'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/layouts\.0\.slots: required/)
    expect(alert).toHaveTextContent(/theme: expected object/)
  })

  it('falls back to a plain message when the server listed nothing', async () => {
    dispatchAction.mockRejectedValue(new Error('network'))
    render(<TemplateFileImport onImported={vi.fn()} />)
    pick(file())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not import this template/i)
  })

  it('nothing is handed back, since nothing was created', async () => {
    const onImported = vi.fn()
    dispatchAction.mockRejectedValue(new Error('network'))
    render(<TemplateFileImport onImported={onImported} />)
    pick(file())

    await screen.findByRole('alert')
    expect(onImported).not.toHaveBeenCalled()
  })

  it('lets the same file be picked again once it has been fixed', async () => {
    // A file input fires no change event for the same filename twice, so the
    // value has to be cleared or a retry silently does nothing
    dispatchAction.mockRejectedValue(new Error('network'))
    render(<TemplateFileImport onImported={vi.fn()} />)
    pick(file())
    await screen.findByRole('alert')

    const input = screen.getByLabelText(
      /import a design file/i,
    ) as HTMLInputElement
    expect(input.value).toBe('')
  })
})
