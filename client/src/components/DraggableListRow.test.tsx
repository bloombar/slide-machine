/**
 * Unit tests for DraggableListRow's drag SURFACE (PROJ-4 follow-up): which
 * mousedown targets are allowed to start a pointer drag, for the default
 * (whole row, minus interactive elements — what slide rows use) and
 * `handleOnly` (only a `data-drag-handle` descendant — what lecture rows
 * use, since their row is a link end to end) modes. The keyboard path
 * (Alt+ArrowUp/Down) is covered elsewhere per consumer (DeckViewerPage,
 * ProjectPage); this file is what neither of those alone would catch: a
 * regression that let a drag start from the wrong place.
 *
 * pragmatic-drag-and-drop's own dragstart handling needs a real
 * `dataTransfer`, which jsdom's DragEvent does not supply on its own — the
 * library's own testing docs ask for exactly this polyfill.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import DraggableListRow from './DraggableListRow'

/** Minimal DataTransfer stand-in — enough for the library's dragstart path
 * (setData/getData/types), not a full spec implementation. */
class FakeDataTransfer {
  private store = new Map<string, string>()
  effectAllowed = 'all'
  dropEffect = 'move'
  get types() {
    return [...this.store.keys()]
  }
  setData(type: string, data: string) {
    this.store.set(type, data)
  }
  getData(type: string) {
    return this.store.get(type) ?? ''
  }
  clearData() {
    this.store.clear()
  }
  setDragImage() {
    // No real drag preview to render in jsdom; the library only needs the
    // method to exist and be callable with `dataTransfer` as `this`.
  }
}

const noop = () => {}

/**
 * Asserts a drag never actually starts. onDragStart is dispatched via
 * requestAnimationFrame internally (see the passing-case tests below), so
 * a synchronous check right after firing dragstart would pass whether or
 * not canDrag returned true — it just hasn't had a tick to run yet either
 * way. This waits the same way the positive assertions do, and requires
 * that wait to time out.
 *
 * Always closes with a dragend: pragmatic-drag-and-drop tracks "a drag is
 * in progress" as module-level state, not per-component, so a regression
 * that let a drag start here — the very thing this asserts against — would
 * otherwise leak an unfinished drag into every later test in the file
 * (each failing on an unrelated assertion, from a single real fault).
 */
const neverDrags = async (row: HTMLElement) => {
  try {
    await expect(
      vi.waitFor(() => expect(row.className).toContain('opacity-40'), {
        timeout: 200,
      }),
    ).rejects.toThrow()
  } finally {
    fireEvent.dragEnd(row, { dataTransfer: new FakeDataTransfer() })
  }
}

afterEach(() => {
  cleanup()
})

describe('DraggableListRow default mode (whole row, e.g. slides)', () => {
  it('starts a drag from a plain (non-interactive) descendant', async () => {
    const { getByRole, getByTestId } = render(
      <ul>
        <DraggableListRow
          id="a"
          index={0}
          label="Row"
          onDropOn={noop}
          onKeyMove={noop}
        >
          <div data-testid="plain">content</div>
        </DraggableListRow>
      </ul>,
    )
    const row = getByRole('listitem')
    fireEvent.mouseDown(getByTestId('plain'))
    fireEvent.dragStart(row, { dataTransfer: new FakeDataTransfer() })
    // onDragStart is dispatched via requestAnimationFrame internally, so
    // "the drag actually began" is a poll, not an immediate read.
    await vi.waitFor(() => expect(row.className).toContain('opacity-40'))
    fireEvent.dragEnd(row, { dataTransfer: new FakeDataTransfer() })
  })

  it('refuses a drag started from an interactive descendant (click-to-edit stays intact)', async () => {
    const { getByRole } = render(
      <ul>
        <DraggableListRow
          id="a"
          index={0}
          label="Row"
          onDropOn={noop}
          onKeyMove={noop}
        >
          <button type="button">Edit</button>
        </DraggableListRow>
      </ul>,
    )
    const row = getByRole('listitem')
    const button = getByRole('button', { name: 'Edit' })
    fireEvent.mouseDown(button)
    fireEvent.dragStart(row, { dataTransfer: new FakeDataTransfer() })
    await neverDrags(row)
  })
})

describe('DraggableListRow handleOnly mode (e.g. lecture rows)', () => {
  it('starts a drag from the data-drag-handle descendant', async () => {
    const { getByRole, getByTestId } = render(
      <ul>
        <DraggableListRow
          id="a"
          index={0}
          label="Row"
          onDropOn={noop}
          onKeyMove={noop}
          handleOnly
        >
          <button type="button" data-drag-handle data-testid="handle">
            grip
          </button>
          <a href="/somewhere">Title</a>
        </DraggableListRow>
      </ul>,
    )
    const row = getByRole('listitem')
    fireEvent.mouseDown(getByTestId('handle'))
    fireEvent.dragStart(row, { dataTransfer: new FakeDataTransfer() })
    await vi.waitFor(() => expect(row.className).toContain('opacity-40'))
    fireEvent.dragEnd(row, { dataTransfer: new FakeDataTransfer() })
  })

  // The regression this file exists to catch: a drag starting from the
  // link would break click-to-open on a lecture's title.
  it('does NOT start a drag from the link, even though it is most of the row', async () => {
    const { getByRole } = render(
      <ul>
        <DraggableListRow
          id="a"
          index={0}
          label="Row"
          onDropOn={noop}
          onKeyMove={noop}
          handleOnly
        >
          <button type="button" data-drag-handle>
            grip
          </button>
          <a href="/somewhere">Title</a>
        </DraggableListRow>
      </ul>,
    )
    const row = getByRole('listitem')
    const link = getByRole('link', { name: 'Title' })
    fireEvent.mouseDown(link)
    fireEvent.dragStart(row, { dataTransfer: new FakeDataTransfer() })
    await neverDrags(row)
  })

  // Same content, no handleOnly: proves the restriction is the flag, not
  // something about the row's children.
  it('the SAME row content starts a drag from anywhere when handleOnly is left off', async () => {
    const { getByRole } = render(
      <ul>
        <DraggableListRow
          id="a"
          index={0}
          label="Row"
          onDropOn={noop}
          onKeyMove={noop}
        >
          <button type="button" data-drag-handle>
            grip
          </button>
          <span>plain text</span>
        </DraggableListRow>
      </ul>,
    )
    const row = getByRole('listitem')
    const span = getByRole('listitem').querySelector('span')!
    fireEvent.mouseDown(span)
    fireEvent.dragStart(row, { dataTransfer: new FakeDataTransfer() })
    await vi.waitFor(() => expect(row.className).toContain('opacity-40'))
    fireEvent.dragEnd(row, { dataTransfer: new FakeDataTransfer() })
  })
})

describe('DraggableListRow keyboard path (unaffected by handleOnly)', () => {
  it('Alt+ArrowDown on the focused row calls onKeyMove, handleOnly or not', () => {
    const calls: Array<[string, -1 | 1]> = []
    const { getByRole } = render(
      <ul>
        <DraggableListRow
          id="a"
          index={0}
          label="Row"
          onDropOn={noop}
          onKeyMove={(id, delta) => calls.push([id, delta])}
          handleOnly
        >
          <button type="button" data-drag-handle>
            grip
          </button>
        </DraggableListRow>
      </ul>,
    )
    fireEvent.keyDown(getByRole('listitem'), { key: 'ArrowDown', altKey: true })
    expect(calls).toEqual([['a', 1]])
  })
})
