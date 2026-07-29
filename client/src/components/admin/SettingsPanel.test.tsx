/**
 * Unit tests for the admin settings panel (ADMIN-5): draft-only editing,
 * the dirty check, the confirm dialog's change list, the patch it sends
 * (changed fields only, cleared ones as null), and how it reports success
 * and refusal.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import SettingsPanel from './SettingsPanel'
import { ApiError } from '../../api/http'
import type { FieldLabels } from '../../lib/admin-changes'

interface Draft {
  visibility: 'public' | 'restricted'
  freedom?: number
}

const labels: FieldLabels<Draft> = {
  visibility: {
    label: 'Visibility',
    format: value => (value === 'public' ? 'Public' : 'Private'),
  },
  freedom: 'AI freedom',
}

const renderPanel = (
  value: Draft,
  onSave: (patch: unknown) => Promise<void> = () => Promise.resolve(),
) => {
  const view = render(
    <SettingsPanel
      value={value}
      labels={labels}
      confirmTitle="Save these settings?"
      description="Editing someone else's settings."
      onSave={onSave}
    >
      {(draft, set) => (
        <>
          <label htmlFor="vis">Visibility</label>
          <select
            id="vis"
            value={draft.visibility}
            onChange={e => set('visibility', e.target.value as 'public')}
          >
            <option value="public">Public</option>
            <option value="restricted">Private</option>
          </select>
          <button onClick={() => set('freedom', undefined)}>
            Reset freedom
          </button>
        </>
      )}
    </SettingsPanel>,
  )
  return view
}

/** Opens the confirm dialog and accepts it. */
const confirmSave = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  const dialog = screen.getByRole('alertdialog', {
    name: 'Save these settings?',
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
}

describe('SettingsPanel', () => {
  it('starts clean, with Save disabled', () => {
    renderPanel({ visibility: 'public', freedom: 3 })
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('lists every change in the confirm dialog', () => {
    renderPanel({ visibility: 'public', freedom: 3 })

    fireEvent.change(screen.getByLabelText('Visibility'), {
      target: { value: 'restricted' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset freedom' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    const dialog = screen.getByRole('alertdialog')
    expect(
      within(dialog).getByText('Visibility: Public → Private'),
    ).toBeVisible()
    expect(
      within(dialog).getByText('AI freedom: 3 → Default (inherited)'),
    ).toBeVisible()
  })

  it('sends only the changed fields, clearing with an explicit null', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderPanel({ visibility: 'public', freedom: 3 }, onSave)

    fireEvent.click(screen.getByRole('button', { name: 'Reset freedom' }))
    confirmSave()

    expect(await screen.findByText('Settings saved.')).toBeVisible()
    // visibility is untouched, so it is absent; a cleared value is null
    expect(onSave).toHaveBeenCalledWith({ freedom: null })
    expect(JSON.stringify(onSave.mock.calls[0]![0])).toBe('{"freedom":null}')
  })

  it('saves nothing when the confirm is cancelled', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderPanel({ visibility: 'public' }, onSave)

    fireEvent.change(screen.getByLabelText('Visibility'), {
      target: { value: 'restricted' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
    // The edit is still pending, so it can still be saved
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  it('reports a refused save through an alert', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          400,
          'target_is_admin',
          'Admin accounts are not moderated',
        ),
      )
    renderPanel({ visibility: 'public' }, onSave)

    fireEvent.change(screen.getByLabelText('Visibility'), {
      target: { value: 'restricted' },
    })
    confirmSave()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Admin accounts are not moderated',
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('follows the saved settings when they are refetched', () => {
    const { rerender } = renderPanel({ visibility: 'public' })
    fireEvent.change(screen.getByLabelText('Visibility'), {
      target: { value: 'restricted' },
    })
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()

    rerender(
      <SettingsPanel
        value={{ visibility: 'restricted' }}
        labels={labels}
        confirmTitle="Save these settings?"
        description="Editing someone else's settings."
        onSave={() => Promise.resolve()}
      >
        {draft => <p>{draft.visibility}</p>}
      </SettingsPanel>,
    )

    // The draft now matches what was stored, so there is nothing to save
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })
})
