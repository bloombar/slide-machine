/**
 * Unit tests for the descriptor-budget notice (TMPL-25).
 *
 * What matters here: it stays out of the way under budget, it names the
 * current length and the recommended maximum when over, it asks for nothing
 * back from the user (no dismiss, no confirm), and a status that cannot be
 * read does not become an error in the author's face.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type {
  Layout,
  Template,
  TemplateDescriptorStatus,
} from '@slide-machine/shared'
import { mockFetchRoutes } from '../../test/fetch-mock'
import TemplateDescriptorNotice from './TemplateDescriptorNotice'

const layout = (): Layout =>
  ({
    type: 'content',
    label: 'Content',
    purpose: 'General slide',
    slots: [{ name: 'title', kind: 'text', label: 'Title' }],
    elementPositions: {},
  }) as Layout

const template = (over: Partial<Template> = {}): Template => ({
  id: 't1',
  permalinkSlug: 't1',
  ownerId: 'u1',
  name: 'My Design',
  theme: {},
  layouts: [layout()],
  visibility: 'private',
  voteScore: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const routes = (status: TemplateDescriptorStatus) =>
  mockFetchRoutes({
    '/api/actions/template.descriptorStatus': () => ({
      status: 200,
      body: status,
    }),
  })

describe('TemplateDescriptorNotice', () => {
  it('shows nothing when the menu is within budget', async () => {
    const { fetchMock } = routes({ length: 1200, max: 5000, overBudget: false })
    render(<TemplateDescriptorNotice template={template()} />)
    // Wait for the under-budget status to actually land before asserting its
    // absence — otherwise this passes trivially on the pre-fetch render,
    // which returns null regardless of what the response says.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        screen.queryByText("This design's instructions are getting long"),
      ).not.toBeInTheDocument(),
    )
  })

  it("clears a previous design's warning immediately on a template change, without waiting for the new status", async () => {
    // The new template's fetch is left hanging deliberately: if the notice
    // only clears once that response lands, this test fails, proving the
    // reset happens synchronously with the prop change rather than as a
    // side effect of the new status arriving.
    const gate: { resolve: (() => void) | null } = { resolve: null }
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const { templateId } = JSON.parse(String(init?.body ?? '{}'))
        if (templateId === 't1') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ length: 5104, max: 5000, overBudget: true }),
          } as Response
        }
        await new Promise<void>(resolve => {
          gate.resolve = resolve
        })
        return {
          ok: true,
          status: 200,
          json: async () => ({ length: 1200, max: 5000, overBudget: false }),
        } as Response
      },
    )
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(
      <TemplateDescriptorNotice template={template({ id: 't1' })} />,
    )
    await screen.findByText("This design's instructions are getting long")

    rerender(
      <TemplateDescriptorNotice
        template={template({ id: 't2', permalinkSlug: 't2' })}
      />,
    )

    await waitFor(() =>
      expect(
        screen.queryByText("This design's instructions are getting long"),
      ).not.toBeInTheDocument(),
    )

    gate.resolve?.()
  })

  it('names the current length and the recommended maximum when over budget', async () => {
    routes({ length: 5104, max: 5000, overBudget: true })
    render(<TemplateDescriptorNotice template={template()} />)
    expect(
      await screen.findByText("This design's instructions are getting long"),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Your boxes' instructions total 5104 characters, over the recommended 5000. Shorten them so generation stays fast and the lecture stays responsive.",
      ),
    ).toBeInTheDocument()
  })

  it('offers no dismiss control — nothing to click away', async () => {
    routes({ length: 5104, max: 5000, overBudget: true })
    render(<TemplateDescriptorNotice template={template()} />)
    await screen.findByText("This design's instructions are getting long")
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('stays silent when the status cannot be read', async () => {
    const { fetchMock } = mockFetchRoutes({
      '/api/actions/template.descriptorStatus': () => ({ status: 500 }),
    })
    render(<TemplateDescriptorNotice template={template()} />)
    // Wait for the failed fetch to actually resolve (and be caught) before
    // asserting silence — otherwise this passes trivially on the pre-fetch
    // render.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        screen.queryByText("This design's instructions are getting long"),
      ).not.toBeInTheDocument(),
    )
  })
})
