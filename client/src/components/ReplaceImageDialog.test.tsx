/**
 * Unit tests for the replace-image dialog (EDIT-1): it searches on open,
 * lets a result be chosen, uploads a picked or dropped file, re-searches
 * from the form, and closes on demand. The search API is mocked so the
 * tests stay offline and deterministic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ImageSearchCandidate } from '@slide-machine/shared'
import ReplaceImageDialog from './ReplaceImageDialog'
import { searchSlideImages } from '../api/slides'

vi.mock('../api/slides', () => ({ searchSlideImages: vi.fn() }))
const mockedSearch = vi.mocked(searchSlideImages)

const candidates: ImageSearchCandidate[] = [
  {
    url: 'http://img/a.png',
    title: 'Cell A',
    source: 'wikimedia',
    attribution: { creator: 'Ada' },
  },
  { url: 'http://img/b.png', title: 'Cell B', source: 'flickr' },
]

const setup = (
  props: Partial<Parameters<typeof ReplaceImageDialog>[0]> = {},
) => {
  const onUpload = vi.fn()
  const onPickCandidate = vi.fn()
  const onClose = vi.fn()
  render(
    <ReplaceImageDialog
      slideId="s1"
      initialQuery="cell"
      onUpload={onUpload}
      onPickCandidate={onPickCandidate}
      onClose={onClose}
      {...props}
    />,
  )
  return { onUpload, onPickCandidate, onClose }
}

beforeEach(() => {
  mockedSearch.mockReset()
})

describe('ReplaceImageDialog', () => {
  it('searches on open using the seeded query and applies a chosen result', async () => {
    mockedSearch.mockResolvedValue(candidates)
    const { onPickCandidate, onClose } = setup()

    expect(mockedSearch).toHaveBeenCalledWith('s1', 'cell')
    const pick = await screen.findByRole('button', {
      name: /Use image: Cell A/,
    })
    fireEvent.click(pick)
    expect(onPickCandidate).toHaveBeenCalledWith(candidates[0])
    expect(onClose).toHaveBeenCalled()
  })

  it('uploads a file chosen from the computer', async () => {
    mockedSearch.mockResolvedValue([])
    const { onUpload, onClose } = setup()
    const file = new File(['x'], 'pic.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Upload image file'), {
      target: { files: [file] },
    })
    expect(onUpload).toHaveBeenCalledWith(file)
    expect(onClose).toHaveBeenCalled()
  })

  it('uses the given title for its heading and label', async () => {
    mockedSearch.mockResolvedValue([])
    setup({ title: 'Add image' })
    expect(
      await screen.findByRole('dialog', { name: 'Add image' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Add image' }),
    ).toBeInTheDocument()
  })

  it('uploads a dropped file', async () => {
    mockedSearch.mockResolvedValue([])
    const { onUpload } = setup()
    const zone = document.querySelector('.border-dashed')!
    const file = new File(['x'], 'drop.png', { type: 'image/png' })
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onUpload).toHaveBeenCalledWith(file)
  })

  it('runs a fresh search from the form and shows the results', async () => {
    mockedSearch.mockResolvedValue([])
    setup()
    expect(await screen.findByText(/No images found/)).toBeInTheDocument()

    mockedSearch.mockResolvedValue(candidates)
    fireEvent.change(screen.getByLabelText('Search for images'), {
      target: { value: 'mitochondria' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(mockedSearch).toHaveBeenLastCalledWith('s1', 'mitochondria')
    expect(
      await screen.findByRole('button', { name: /Use image: Cell B/ }),
    ).toBeInTheDocument()
  })

  it('shows an empty state when a search fails', async () => {
    mockedSearch.mockRejectedValue(new Error('offline'))
    setup()
    expect(await screen.findByText(/No images found/)).toBeInTheDocument()
  })

  it('closes on the close button and on Escape', async () => {
    mockedSearch.mockResolvedValue([])
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
