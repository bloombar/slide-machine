/**
 * Unit tests for the Drive chooser (EXP-3/EXP-4/QUIZ-2).
 *
 * One component answers three situations, and picking the wrong one is a
 * silent failure: a live deployment shown the mock dialog would offer folders
 * that do not exist, and a live deployment with no Picker key would open a
 * chooser that could only come back empty. So the routing is pinned here,
 * along with what each branch does with what the user chose.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { DrivePickerConfig } from '@slide-machine/shared'
import DrivePicker from './DrivePicker'

const dispatchAction = vi.fn()
vi.mock('../api/actions', () => ({
  dispatchAction: (...args: unknown[]) => dispatchAction(...args),
}))

const openGooglePicker = vi.fn()
vi.mock('../lib/google-picker', async () => {
  const actual = await vi.importActual<typeof import('../lib/google-picker')>(
    '../lib/google-picker',
  )
  return {
    ...actual,
    openGooglePicker: (...a: unknown[]) => openGooglePicker(...a),
  }
})

let mode: DrivePickerConfig = { mode: 'mock' }
vi.mock('../runtime-config', () => ({ getDrivePicker: () => mode }))

/** The mock Drive both fallback listings read. */
const TREE = {
  folders: [{ id: 'folder-quizzes', name: 'Quizzes' }],
  files: [
    {
      id: 'deck-1',
      name: 'Photosynthesis',
      mimeType: 'application/vnd.google-apps.presentation',
    },
  ],
}

const props = {
  title: 'Choose somewhere',
  confirmLabel: 'Save here',
  busyLabel: 'Saving…',
  onPick: vi.fn(),
  onCancel: vi.fn(),
  onReconnect: vi.fn(),
}

beforeEach(() => {
  mode = { mode: 'mock' }
  dispatchAction.mockReset()
  openGooglePicker.mockReset()
  props.onPick.mockReset()
  props.onCancel.mockReset()
  props.onReconnect.mockReset()
  dispatchAction.mockImplementation((action: string) =>
    action === 'drive.importables'
      ? Promise.resolve(TREE)
      : action === 'quiz.driveFolders'
        ? Promise.resolve({ folders: TREE.folders })
        : Promise.resolve({ accessToken: 'ya29.fresh' }),
  )
})

describe("Google's own picker", () => {
  beforeEach(() => {
    mode = { mode: 'google', apiKey: 'browser-key', appId: '1234567890' }
  })

  it('opens with a token minted for the connected account', async () => {
    openGooglePicker.mockResolvedValue(null)
    render(<DrivePicker kind="folder" {...props} />)

    await waitFor(() => expect(openGooglePicker).toHaveBeenCalled())
    expect(dispatchAction).toHaveBeenCalledWith('drive.pickerToken', {})
    expect(openGooglePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'browser-key',
        appId: '1234567890',
        accessToken: 'ya29.fresh',
        kind: 'folder',
      }),
    )
  })

  it('draws nothing of its own — the widget is Google’s', async () => {
    openGooglePicker.mockResolvedValue(null)
    const { container } = render(<DrivePicker kind="folder" {...props} />)
    await waitFor(() => expect(openGooglePicker).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('hands back what was picked', async () => {
    const file = {
      id: 'deck-1',
      name: 'Photosynthesis',
      mimeType: 'application/vnd.google-apps.presentation',
    }
    openGooglePicker.mockResolvedValue(file)
    render(<DrivePicker kind="importable" {...props} />)

    await waitFor(() => expect(props.onPick).toHaveBeenCalledWith(file))
  })

  it('closes rather than hangs when the user picks nothing', async () => {
    openGooglePicker.mockResolvedValue(null)
    render(<DrivePicker kind="importable" {...props} />)

    await waitFor(() => expect(props.onCancel).toHaveBeenCalled())
    expect(props.onPick).not.toHaveBeenCalled()
  })

  it('offers the reconnect when the token cannot be minted', async () => {
    // A grant Google will no longer exchange is a step the instructor can
    // take, not a dead end.
    dispatchAction.mockRejectedValue(new Error('google_reconnect'))
    render(<DrivePicker kind="folder" {...props} />)

    expect(await screen.findByText(/could not be opened/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }))
    expect(props.onReconnect).toHaveBeenCalled()
  })
})

describe('the fallback dialog, where there is no Google', () => {
  it('confirms the folder you are standing in', async () => {
    render(<DrivePicker kind="folder" {...props} />)
    await screen.findByRole('button', { name: 'Quizzes' })

    fireEvent.click(screen.getByRole('button', { name: 'Save here' }))
    expect(props.onPick).toHaveBeenCalledWith({
      id: 'root',
      name: 'My Drive',
      mimeType: 'application/vnd.google-apps.folder',
    })
  })

  it('steps into a folder and confirms that one instead', async () => {
    render(<DrivePicker kind="folder" {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Quizzes' }))

    await waitFor(() =>
      expect(dispatchAction).toHaveBeenCalledWith('quiz.driveFolders', {
        parentId: 'folder-quizzes',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save here' }))
    expect(props.onPick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'folder-quizzes', name: 'Quizzes' }),
    )
  })

  it('lists files to import, and hands back the one clicked', async () => {
    render(<DrivePicker kind="importable" {...props} />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Photosynthesis' }),
    )
    expect(props.onPick).toHaveBeenCalledWith(TREE.files[0])
  })

  it('offers no confirm when importing — the file IS the answer', async () => {
    render(<DrivePicker kind="importable" {...props} />)
    await screen.findByRole('button', { name: 'Photosynthesis' })
    expect(
      screen.queryByRole('button', { name: 'Save here' }),
    ).not.toBeInTheDocument()
  })

  it('offers the reconnect when the listing fails', async () => {
    dispatchAction.mockRejectedValue(new Error('nope'))
    render(<DrivePicker kind="folder" {...props} />)

    expect(
      await screen.findByText(/may not have granted Drive access/i),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }))
    expect(props.onReconnect).toHaveBeenCalled()
  })
})

describe('live, but with no Picker configured', () => {
  it('says so rather than opening a chooser that cannot work', async () => {
    mode = { mode: 'none' }
    render(<DrivePicker kind="folder" {...props} />)

    expect(await screen.findByText(/is not set up/i)).toBeInTheDocument()
    // Emphatically not the mock tree: fabricated folders on a live
    // deployment would offer destinations that do not exist.
    expect(dispatchAction).not.toHaveBeenCalled()
    expect(openGooglePicker).not.toHaveBeenCalled()
  })
})
