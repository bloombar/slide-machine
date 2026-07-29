/**
 * Unit tests for the admin details panel (ADMIN-5): the read-only list it
 * opens as, the audit confirmation that unlocks it, draft-only editing,
 * the dirty check, the confirm dialog's change list, the patch it sends
 * (changed fields only, cleared ones as null), and how it reports success
 * and refusal.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import DetailsPanel from './DetailsPanel'
import DetailField from './DetailField'
import DetailRow from './DetailRow'
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
) =>
  render(
    <DetailsPanel
      value={value}
      labels={labels}
      confirmTitle="Save these settings?"
      editConfirmTitle="Edit these details?"
      editConfirmMessage="This belongs to another user; every change is recorded in the audit log."
      onSave={onSave}
    >
      {({ editing, draft, set }) => (
        <>
          <DetailRow label="Owner" value="Ada" />
          <DetailField
            label="Visibility"
            value={draft.visibility === 'public' ? 'Public' : 'Private'}
            editing={editing}
            htmlFor="vis"
          >
            <select
              id="vis"
              value={draft.visibility}
              onChange={e => set('visibility', e.target.value as 'public')}
            >
              <option value="public">Public</option>
              <option value="restricted">Private</option>
            </select>
          </DetailField>
          <DetailField
            label="AI freedom"
            value={String(draft.freedom ?? 'Default (inherited)')}
            editing={editing}
          >
            <button onClick={() => set('freedom', undefined)}>
              Reset freedom
            </button>
          </DetailField>
        </>
      )}
    </DetailsPanel>,
  )

/** Clicks Edit and accepts the audit confirmation, unlocking the form. */
const startEditing = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const ask = screen.getByRole('alertdialog', { name: 'Edit these details?' })
  fireEvent.click(within(ask).getByRole('button', { name: 'Edit settings' }))
}

/** Opens the save confirm dialog and accepts it. */
const confirmSave = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  const dialog = screen.getByRole('alertdialog', {
    name: 'Save these settings?',
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
}

describe('DetailsPanel', () => {
  it('opens read-only, with the values listed and no controls', () => {
    renderPanel({ visibility: 'public', freedom: 3 })

    expect(screen.getByText('Public')).toBeVisible()
    expect(screen.getByText('3')).toBeVisible()
    expect(screen.queryByLabelText('Visibility')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument()
  })

  it('warns that the edit is audited before unlocking the form', () => {
    renderPanel({ visibility: 'public', freedom: 3 })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const ask = screen.getByRole('alertdialog', { name: 'Edit these details?' })
    expect(ask).toHaveTextContent('recorded in the audit log')
    // Still locked while the dialog is only open
    expect(screen.queryByLabelText('Visibility')).not.toBeInTheDocument()

    fireEvent.click(within(ask).getByRole('button', { name: 'Edit settings' }))
    expect(screen.getByLabelText('Visibility')).toBeVisible()
  })

  it('stays read-only when the edit confirm is cancelled', () => {
    renderPanel({ visibility: 'public', freedom: 3 })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Visibility')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeVisible()
  })

  it('starts clean, with Save disabled', () => {
    renderPanel({ visibility: 'public', freedom: 3 })
    startEditing()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('lists every change in the confirm dialog', () => {
    renderPanel({ visibility: 'public', freedom: 3 })
    startEditing()

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
    startEditing()

    fireEvent.click(screen.getByRole('button', { name: 'Reset freedom' }))
    confirmSave()

    expect(await screen.findByText('Settings saved.')).toBeVisible()
    // visibility is untouched, so it is absent; a cleared value is null
    expect(onSave).toHaveBeenCalledWith({ freedom: null })
    expect(JSON.stringify(onSave.mock.calls[0]![0])).toBe('{"freedom":null}')
  })

  it('locks the list again once the save lands', async () => {
    renderPanel({ visibility: 'public', freedom: 3 })
    startEditing()

    fireEvent.change(screen.getByLabelText('Visibility'), {
      target: { value: 'restricted' },
    })
    confirmSave()

    expect(await screen.findByText('Settings saved.')).toBeVisible()
    expect(screen.queryByLabelText('Visibility')).not.toBeInTheDocument()
    // The list shows what was just saved, without waiting for a refetch
    expect(screen.getByText('Private')).toBeVisible()
  })

  it('saves nothing when the save confirm is cancelled', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderPanel({ visibility: 'public' }, onSave)
    startEditing()

    fireEvent.change(screen.getByLabelText('Visibility'), {
      target: { value: 'restricted' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Cancel',
      }),
    )

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
    // The edit is still pending, so it can still be saved
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  it('drops the pending edit when the form is cancelled', () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    renderPanel({ visibility: 'public' }, onSave)
    startEditing()

    fireEvent.change(screen.getByLabelText('Visibility'), {
      target: { value: 'restricted' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Public')).toBeVisible()
    // Re-opening the form starts from the stored value again
    startEditing()
    expect(screen.getByLabelText('Visibility')).toHaveValue('public')
  })

  it('reports a refused save through an alert, leaving the form open', async () => {
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
    startEditing()

    fireEvent.change(screen.getByLabelText('Visibility'), {
      target: { value: 'restricted' },
    })
    confirmSave()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Admin accounts are not moderated',
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // The edit survives, so it can be retried
    expect(screen.getByLabelText('Visibility')).toHaveValue('restricted')
  })

  it('follows the saved settings when they are refetched', () => {
    const { rerender } = renderPanel({ visibility: 'public' })
    startEditing()
    fireEvent.change(screen.getByLabelText('Visibility'), {
      target: { value: 'restricted' },
    })
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()

    rerender(
      <DetailsPanel
        value={{ visibility: 'restricted' }}
        labels={labels}
        confirmTitle="Save these settings?"
        editConfirmTitle="Edit these details?"
        editConfirmMessage="This belongs to another user; every change is recorded in the audit log."
        onSave={() => Promise.resolve()}
      >
        {({ draft }) => <p>{draft.visibility}</p>}
      </DetailsPanel>,
    )

    // The draft now matches what was stored, so there is nothing to save
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })
})
