/**
 * Importing a design from Google Slides (TMPL-8), from the instructor's side.
 *
 * Two things carry this screen: a pasted link has to become a presentation id
 * without the instructor thinking about it, and the report has to say what the
 * import did — consolidation is lossy, and silence about it would leave the
 * author wondering what was thrown away.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { Template } from '@slide-machine/shared'
import TemplateImport, {
  presentationIdFrom,
  importSourceFrom,
} from './TemplateImport'
import { ApiError } from '../../api/http'

const dispatchAction = vi.fn()
vi.mock('../../api/actions', () => ({
  dispatchAction: (...args: unknown[]) => dispatchAction(...args),
}))

const template = { id: 't1', name: 'Imported design' } as Template

const result = (over: Record<string, unknown> = {}) => ({
  template,
  report: {
    slidesRead: 38,
    layoutsCreated: 6,
    largestMerge: { type: 'title-and-bullets', slides: 11 },
    approximated: 2,
    assetsFailed: 0,
    ...over,
  },
})

beforeEach(() => {
  dispatchAction.mockReset()
  dispatchAction.mockResolvedValue(result())
})

/** Opens the panel, which stays out of the way until asked for. */
const openPanel = () => {
  fireEvent.click(screen.getByRole('button', { name: /import a design/i }))
}

/** Types a link and submits it. */
const importLink = (link: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: link } })
  fireEvent.click(screen.getByRole('button', { name: /import design/i }))
}

describe('the link an instructor pastes', () => {
  it('is read out of a Google Slides URL', () => {
    expect(
      presentationIdFrom(
        'https://docs.google.com/presentation/d/1AbC_dEf-123/edit?usp=drivesdk',
      ),
    ).toBe('1AbC_dEf-123')
  })

  it('is read out of a Drive link that carries it as a parameter', () => {
    expect(
      presentationIdFrom('https://drive.google.com/open?id=1AbC_dEf'),
    ).toBe('1AbC_dEf')
  })

  it('is taken as-is when they pasted the bare id', () => {
    expect(presentationIdFrom('1AbCdEfGhIjKl')).toBe('1AbCdEfGhIjKl')
  })

  it('is nothing when they pasted something else', () => {
    // Better a clear complaint than a confusing failure from the server
    expect(presentationIdFrom('my lecture deck')).toBeNull()
    expect(presentationIdFrom('')).toBeNull()
    expect(presentationIdFrom('   ')).toBeNull()
  })

  it('ignores surrounding whitespace, which a paste often brings', () => {
    expect(presentationIdFrom('  1AbCdEfGhIjKl \n')).toBe('1AbCdEfGhIjKl')
  })
})

describe('what a pasted link turns out to be', () => {
  it('sends a presentation to the design import', () => {
    expect(
      importSourceFrom(
        'https://docs.google.com/presentation/d/1AbC_dEf-123/edit',
      ),
    ).toEqual({ action: 'template.importFromSlides', id: '1AbC_dEf-123' })
  })

  it('sends a Drive file to the file import, which is what one is', () => {
    // `/file/d/` is Drive's shape for a stored file, and an exported design
    // is exactly that — so the instructor pastes either link in one box and
    // does not have to know which of two it belonged in
    expect(
      importSourceFrom('https://drive.google.com/file/d/1FiLe_iD-99/view'),
    ).toEqual({ action: 'template.importFromDrive', id: '1FiLe_iD-99' })
  })

  it('takes a bare id as a presentation, which is what gets pasted', () => {
    expect(importSourceFrom('1AbCdEfGhIjKl')).toEqual({
      action: 'template.importFromSlides',
      id: '1AbCdEfGhIjKl',
    })
  })

  it('is nothing when they pasted something else', () => {
    expect(importSourceFrom('my lecture deck')).toBeNull()
    expect(importSourceFrom('   ')).toBeNull()
  })
})

describe('importing', () => {
  it('stays out of the way until asked for', () => {
    render(<TemplateImport onImported={vi.fn()} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('will not submit until the link is one', async () => {
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    expect(
      screen.getByRole('button', { name: /import design/i }),
    ).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'not a link' },
    })
    expect(
      screen.getByRole('button', { name: /import design/i }),
    ).toBeDisabled()
    expect(screen.getByText(/doesn't look like/i)).toBeInTheDocument()
  })

  it('says nothing about an empty field, which is not a mistake yet', async () => {
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    expect(screen.queryByText(/doesn't look like/i)).not.toBeInTheDocument()
  })

  it('sends the id it found, not the whole link', async () => {
    dispatchAction.mockResolvedValue(result())
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    importLink('https://docs.google.com/presentation/d/1AbC_dEf-123/edit')

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith('template.importFromSlides', {
        presentationId: '1AbC_dEf-123',
      }),
    )
  })

  it('consolidates unless told otherwise, which is the useful default', async () => {
    // Off is not the same as sent-as-false: the server's default IS
    // consolidation, so the ordinary import says nothing about it (TMPL-8)
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    importLink('1AbCdEfGhIjKl')

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith('template.importFromSlides', {
        presentationId: '1AbCdEfGhIjKl',
      }),
    )
  })

  it('asks for every slide when the instructor ticks the box', async () => {
    // The judgement offered rather than assumed: a short deck of genuinely
    // different pages wants them all back
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    fireEvent.click(screen.getByRole('checkbox'))
    importLink('1AbCdEfGhIjKl')

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith('template.importFromSlides', {
        presentationId: '1AbCdEfGhIjKl',
        keepEverySlide: true,
      }),
    )
  })

  it('hands the new design back so it can be worn straight away', async () => {
    const onImported = vi.fn()
    dispatchAction.mockResolvedValue(result())
    render(<TemplateImport onImported={onImported} />)
    openPanel()
    importLink('1AbCdEfGhIjKl')

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(template))
  })

  it('says it is working, since reading a deck is not instant', async () => {
    dispatchAction.mockReturnValue(new Promise(() => {}))
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    importLink('1AbCdEfGhIjKl')

    expect(await screen.findByText(/reading the presentation/i)).toBeVisible()
  })
})

describe('what the instructor is told afterwards', () => {
  const importOne = async (over: Record<string, unknown> = {}) => {
    dispatchAction.mockResolvedValue(result(over))
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    importLink('1AbCdEfGhIjKl')
    await screen.findByRole('status')
  }

  it('says how many slides became how many layouts', async () => {
    await importOne()
    expect(screen.getByRole('status')).toHaveTextContent(
      '38 slides became 6 layouts',
    )
  })

  it('says what was merged and what was only approximated', async () => {
    // Consolidation is a judgment call, so it is stated rather than logged
    await importOne()
    const report = screen.getByRole('status')
    expect(report).toHaveTextContent(/merged 11 near-identical slides/i)
    expect(report).toHaveTextContent(/2 slides matched no layout/i)
  })

  it('mentions images that could not be retrieved', async () => {
    await importOne({ assetsFailed: 3 })
    expect(screen.getByRole('status')).toHaveTextContent(
      /3 images could not be retrieved/i,
    )
  })

  it('stays quiet about the things that did not happen', async () => {
    await importOne({
      approximated: 0,
      assetsFailed: 0,
      largestMerge: undefined,
    })
    const report = screen.getByRole('status')
    expect(report).not.toHaveTextContent(/approximated/i)
    expect(report).not.toHaveTextContent(/could not be retrieved/i)
    expect(report).not.toHaveTextContent(/merged/i)
  })

  it('says the presentation itself was left alone', async () => {
    await importOne()
    expect(screen.getByRole('status')).toHaveTextContent(
      /nothing was changed in the presentation/i,
    )
  })
})

describe('when it will not work', () => {
  it('explains a presentation Google would not hand over', async () => {
    // Told apart by code rather than by sniffing the message for "google",
    // which missed every refusal it had not seen before — and missed this one
    // entirely while it arrived as a plain 500
    dispatchAction.mockImplementation(() =>
      Promise.reject(
        new ApiError(400, 'source_unreadable', 'Slides read failed (500)'),
      ),
    )
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    importLink('1AbCdEfGhIjKl')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /would not hand over that file/i,
    )
  })

  it('says a presentation that is not there is not there', async () => {
    // A different instruction from a refused read: check the link, not the
    // account
    dispatchAction.mockImplementation(() =>
      Promise.reject(
        new ApiError(
          404,
          'source_not_found',
          'That presentation was not found',
        ),
      ),
    )
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    importLink('1AbCdEfGhIjKl')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /not found in your drive/i,
    )
  })

  it('offers the reconnect when Google refuses the account', async () => {
    dispatchAction.mockImplementation(() =>
      Promise.reject(
        new ApiError(403, 'google_reconnect', 'would not let this account'),
      ),
    )
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    importLink('1AbCdEfGhIjKl')

    expect(
      await screen.findByRole('button', { name: /connect google/i }),
    ).toBeInTheDocument()
  })

  it('reports any other failure without blaming the instructor', async () => {
    dispatchAction.mockImplementation(() => Promise.reject(new Error('boom')))
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    importLink('1AbCdEfGhIjKl')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not import that presentation/i,
    )
  })
})

describe('a design file kept in Drive', () => {
  it('is imported by its link, through the file route', async () => {
    dispatchAction.mockResolvedValue(template)
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    importLink('https://drive.google.com/file/d/1FiLe_iD-99/view')

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith('template.importFromDrive', {
        fileId: '1FiLe_iD-99',
      }),
    )
  })

  it('offers no consolidation choice, having no slides to consolidate', () => {
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    expect(screen.getByRole('checkbox')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://drive.google.com/file/d/1FiLe_iD-99/view' },
    })
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('hands the template back the same way, though nothing is reported', async () => {
    // A file comes back as the template it already was: no slides were read,
    // so there is nothing to say about what became of them
    const onImported = vi.fn()
    dispatchAction.mockResolvedValue(template)
    render(<TemplateImport onImported={onImported} />)
    openPanel()
    importLink('https://drive.google.com/file/d/1FiLe_iD-99/view')

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(template))
    expect(screen.queryByTestId('import-report')).not.toBeInTheDocument()
  })
})
