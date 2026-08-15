/**
 * Unit tests for the "+" menu: the ways to start something, the project
 * page's two-item variant, and the ordinary menu manners (outside click,
 * Escape).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CreateMenu from './CreateMenu'

const renderMenu = (props: Partial<Parameters<typeof CreateMenu>[0]>) =>
  render(
    <CreateMenu
      onNewProject={vi.fn()}
      onNewLecture={vi.fn()}
      onImportLecture={vi.fn()}
      {...props}
    />,
  )

const open = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Create new' }))

describe('CreateMenu', () => {
  it('opens on the "+" and lists the three options with icons', () => {
    renderMenu({})
    expect(screen.queryByRole('menu')).toBeNull()
    open()

    const items = screen.getAllByRole('menuitem')
    expect(items.map(i => i.textContent)).toEqual([
      'New project',
      'New lecture',
      'Import a lecture',
    ])
    // Each item is prefixed by a decorative icon
    for (const item of items) expect(item.querySelector('svg')).not.toBeNull()
  })

  it('drops New project when no handler is given', () => {
    render(<CreateMenu onNewLecture={vi.fn()} onImportLecture={vi.fn()} />)
    open()

    expect(screen.getAllByRole('menuitem').map(i => i.textContent)).toEqual([
      'New lecture',
      'Import a lecture',
    ])
  })

  it('fires onNewProject and onNewLecture, closing behind each', () => {
    const onNewProject = vi.fn()
    const onNewLecture = vi.fn()
    renderMenu({ onNewProject, onNewLecture })

    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New project' }))
    expect(onNewProject).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()

    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New lecture' }))
    expect(onNewLecture).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the import panel rather than picking a file itself', () => {
    // Importing is one entry, not one per source: the panel asks where the
    // lecture is coming from, so the menu no longer has to know
    const onImportLecture = vi.fn()
    renderMenu({ onImportLecture })
    open()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Import a lecture' }))

    expect(onImportLecture).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers one import entry, whatever the lecture is coming from', () => {
    renderMenu({})
    open()
    expect(
      screen
        .getAllByRole('menuitem')
        .filter(i => /import/i.test(i.textContent ?? '')),
    ).toHaveLength(1)
  })

  it('closes on an outside click and on Escape', () => {
    renderMenu({})

    open()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()

    open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
