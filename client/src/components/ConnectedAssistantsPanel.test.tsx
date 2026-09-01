/**
 * Unit tests for the connected-assistants panel (docs/MCP.md §5.3).
 *
 * The promise being tested is "disconnect one, stay signed in everywhere
 * else": the button must cut exactly the assistant it sits next to, and the
 * list afterwards must come from the server rather than from optimism.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import ConnectedAssistantsPanel from './ConnectedAssistantsPanel'
import { mockFetchRoutes } from '../test/fetch-mock'
import * as runtimeConfig from '../runtime-config'

const CONNECTIONS = [
  {
    clientId: 'client-a',
    clientName: 'Claude',
    permissions: ['See your lectures', 'Create and change lectures'],
    connectedAt: '2026-08-01T10:00:00.000Z',
  },
  {
    clientId: 'client-b',
    clientName: 'An unnamed assistant',
    permissions: ['See your designs'],
    connectedAt: '2026-08-02T10:00:00.000Z',
  },
]

beforeEach(() => {
  // The deployment can host agent access unless a test says otherwise.
  vi.spyOn(runtimeConfig, 'getAgentAccessEnabled').mockReturnValue(true)
  Object.defineProperty(window, 'location', {
    value: { origin: 'https://slides.example.edu' },
    writable: true,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const renderPanel = (
  connections: unknown = CONNECTIONS,
  {
    failList = false,
    failCut = false,
    listError,
  }: {
    failList?: boolean
    failCut?: boolean
    /** A specific error body, for codes the app has no global wording for. */
    listError?: { status: number; body: unknown }
  } = {},
) => {
  let listed = 0
  const mock = mockFetchRoutes({
    '/api/actions/mcp.connections': () => {
      listed += 1
      if (listError) return listError
      if (failList) return { status: 500 }
      // The second read is what the panel does after a disconnect, so it
      // returns what the server would then say.
      return {
        status: 200,
        body: listed > 1 ? [CONNECTIONS[1]] : connections,
      }
    },
    '/api/actions/mcp.disconnect': () =>
      failCut ? { status: 500 } : { status: 200, body: { disconnected: 2 } },
  })
  render(<ConnectedAssistantsPanel />)
  return mock
}

describe('the list', () => {
  it('names each assistant, when it connected, and what it may do', async () => {
    renderPanel()

    expect(await screen.findByText('Claude')).toBeTruthy()
    expect(screen.getByText('See your lectures')).toBeTruthy()
    expect(screen.getByText('Create and change lectures')).toBeTruthy()
    expect(screen.getByText(/Connected Aug 1, 2026/)).toBeTruthy()
  })

  it('says plainly when nothing is connected', async () => {
    renderPanel([])
    expect(
      await screen.findByText(/No AI assistants are connected/),
    ).toBeTruthy()
  })

  it('reports a failure to load rather than showing an empty list', async () => {
    // An empty list and a failed read mean opposite things to someone
    // checking whether they are still exposed. A bare server failure gets the
    // application's own global wording, as every other call site's does.
    renderPanel(CONNECTIONS, { failList: true })
    expect(await screen.findByText(/Something went wrong/)).toBeTruthy()
    expect(screen.queryByText(/No AI assistants/)).toBeNull()
  })

  it('falls back to its own wording for a failure the app has no phrase for', async () => {
    renderPanel(CONNECTIONS, {
      listError: {
        status: 400,
        body: { error: { code: 'invalid_input', message: 'nope' } },
      },
    })
    expect(await screen.findByText(/Could not load/)).toBeTruthy()
  })
})

describe('disconnecting', () => {
  it('cuts the assistant whose button was pressed', async () => {
    const { fetchMock } = renderPanel()
    await screen.findByText('Claude')

    fireEvent.click(screen.getAllByRole('button', { name: /Disconnect/ })[0]!)

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('mcp.disconnect'),
      )
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        clientId: 'client-a',
      })
    })
  })

  it('re-reads the list from the server rather than assuming', async () => {
    // A token could have expired between the two calls; the server is the
    // one that knows what is still connected.
    renderPanel()
    await screen.findByText('Claude')

    fireEvent.click(screen.getAllByRole('button', { name: /Disconnect/ })[0]!)

    await waitFor(() => expect(screen.queryByText('Claude')).toBeNull())
    expect(screen.getByText('An unnamed assistant')).toBeTruthy()
  })

  it.each([
    ['a list', { ok: true, status: 200, json: async () => CONNECTIONS }],
    ['a failure', { ok: false, status: 500, json: async () => ({}) }],
  ])(
    'drops %s that arrives after the panel is gone',
    async (_label, answer) => {
      // The panel sits in a settings tab people switch away from, so both
      // paths guard against updating a component that is no longer mounted.
      let settle: (value: Response) => void = () => {}
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise<Response>(resolve => {
              settle = resolve
            }),
        ),
      )

      const view = render(<ConnectedAssistantsPanel />)
      await waitFor(() => expect(settle).toBeInstanceOf(Function))
      view.unmount()
      settle(answer as unknown as Response)
      await Promise.resolve()

      expect(screen.queryByText('Claude')).toBeNull()
      expect(screen.queryByText(/Something went wrong/)).toBeNull()
    },
  )

  it('says so when the disconnect did not go through', async () => {
    renderPanel(CONNECTIONS, { failCut: true })
    await screen.findByText('Claude')

    fireEvent.click(screen.getAllByRole('button', { name: /Disconnect/ })[0]!)
    // The assistant is still listed: nothing is hidden that was not cut.
    expect(await screen.findByText(/Something went wrong/)).toBeTruthy()
  })
})

describe('how to connect one', () => {
  it('hands over the address to paste, since the app cannot start the flow', async () => {
    // There is no "connect" button and cannot be — an authorization flow
    // begins at the assistant. The address is the only part of it the app
    // can offer, and without it the panel is a dead end.
    renderPanel()

    expect(await screen.findByText('Connect an assistant')).toBeTruthy()
    expect(screen.getByText('https://slides.example.edu/api/mcp')).toBeTruthy()
  })

  it('shows it to an account with nothing connected — the case that needs it most', async () => {
    renderPanel([])

    expect(
      await screen.findByText(/No AI assistants are connected/),
    ).toBeTruthy()
    expect(screen.getByText('https://slides.example.edu/api/mcp')).toBeTruthy()
  })

  it('says the assistant will come back for approval', async () => {
    // Someone pasting an address into a third-party tool should know a consent
    // step is coming, rather than wondering what they just authorised.
    renderPanel()
    expect(
      await screen.findByText(/send you back here to approve/),
    ).toBeTruthy()
  })

  it('copies the address, and says it did', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: /Copy/ }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'https://slides.example.edu/api/mcp',
      ),
    )
    expect(await screen.findByText('Copied')).toBeTruthy()
  })

  it('stops saying "Copied" after a moment, so the label is not stale', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: /Copy/ }))
    expect(await screen.findByText('Copied')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(2100)
    })
    expect(screen.queryByText('Copied')).toBeNull()
    vi.useRealTimers()
  })

  it('leaves the address on screen when the clipboard refuses', async () => {
    // Clipboard access can be denied by permission policy. The address is
    // selectable either way, so this is a convenience failing, not the panel.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      writable: true,
    })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: /Copy/ }))
    expect(screen.getByText('https://slides.example.edu/api/mcp')).toBeTruthy()
    expect(screen.queryByText('Copied')).toBeNull()
  })

  it('offers nothing to a deployment that cannot host an assistant', async () => {
    // An https origin is required. Handing out an address that would refuse
    // the assistant is worse than saying nothing.
    vi.spyOn(runtimeConfig, 'getAgentAccessEnabled').mockReturnValue(false)
    renderPanel([])

    expect(
      await screen.findByText(/No AI assistants are connected/),
    ).toBeTruthy()
    expect(screen.queryByText('Connect an assistant')).toBeNull()
  })
})
