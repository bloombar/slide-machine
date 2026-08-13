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
import TemplateImport, { presentationIdFrom } from './TemplateImport'

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
    dispatchAction.mockImplementation(() =>
      Promise.reject(new Error('google_read_failed')),
    )
    render(<TemplateImport onImported={vi.fn()} />)
    openPanel()
    importLink('1AbCdEfGhIjKl')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /check you can open it yourself/i,
    )
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
