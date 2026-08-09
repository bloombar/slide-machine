/**
 * Template versions and the opt-in update, end to end (TMPL-11).
 *
 * A lecture is drawn with the template version it pinned, so editing the
 * template must not reach into it. This drives the whole promise in a real
 * browser against a live server: edit the design, confirm the lecture has not
 * moved, then take the update deliberately and watch the content follow the
 * box it was paired with.
 *
 * Setup runs through the API — building a template edit by hand in the editor
 * would test the editor, not this — but every assertion about the offer, the
 * dialog and the result is made against the UI the user actually sees.
 */
import { test, expect, type APIRequestContext, type Page } from './fixtures'

const stamp = Date.now()
const account = {
  email: `tmplupd-${stamp}@example.com`,
  displayName: 'Grace',
}
const password = 'sturdy-passw0rd'

/** Layout nodes name the slots they draw; a rename has to reach both. */
interface Node {
  slot?: string
  children?: Node[]
}

const renameInTree = (node: Node | undefined, from: string, to: string) => {
  if (!node) return
  if (node.slot === from) node.slot = to
  for (const child of node.children ?? []) renameInTree(child, from, to)
}

/** Calls an action as the signed-in user. */
const act = async (
  request: APIRequestContext,
  token: string,
  name: string,
  data: object,
) => {
  const res = await request.post(`/api/actions/${name}`, {
    data,
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status(), `${name}: ${await res.text()}`).toBe(200)
  return res.json()
}

const openDesignTab = async (page: Page) => {
  await page.getByRole('button', { name: 'Lecture settings' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Lecture settings' }),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Design' }).click()
}

test('a template edit is offered to a lecture, not applied to it', async ({
  page,
}) => {
  // ---- Sign up, and build a lecture on a template the user owns ----
  const reg = await page.request.post('/api/auth/register', {
    data: { ...account, password },
  })
  expect(reg.status()).toBe(201)
  const token = (await reg.json()).accessToken as string

  const project = await act(page.request, token, 'project.create', {
    title: `Waves ${stamp}`,
  })
  const template = await act(page.request, token, 'template.duplicate', {
    templateId: 'classic',
  })
  const deck = await act(page.request, token, 'deck.create', {
    projectId: project.id,
    title: 'Standing waves',
  })
  await act(page.request, token, 'deck.switchTemplate', {
    deckId: deck.id,
    templateId: template.id,
  })
  const slide = await act(page.request, token, 'slide.add', {
    deckId: deck.id,
  })
  await act(page.request, token, 'slide.editContent', {
    slideId: slide.id,
    title: 'Standing waves',
    body: 'A wave that stays in place.',
  })

  await page.goto(`/d/${deck.permalinkSlug}`)
  await expect(page.getByTestId('slide')).toContainText('Standing waves')

  // Nothing has changed yet, so nothing is offered.
  await openDesignTab(page)
  await expect(page.getByText('This design has been updated')).toBeHidden()
  await page.getByRole('button', { name: 'Close settings' }).click()

  // ---- Edit the template: the lecture must not budge ----
  const layouts = template.layouts as {
    type: string
    slots: { name: string }[]
    tree?: Node
    elementPositions?: Record<string, unknown>
  }[]
  const content = layouts.find(l => l.type === 'content')!
  content.slots = content.slots.map(s =>
    s.name === 'body' ? { ...s, name: 'prose' } : s,
  )
  renameInTree(content.tree, 'body', 'prose')
  if (content.elementPositions?.body) {
    content.elementPositions.prose = content.elementPositions.body
    delete content.elementPositions.body
  }
  await act(page.request, token, 'template.update', {
    templateId: template.id,
    name: template.name,
    renderMode: template.renderMode,
    theme: template.theme,
    layouts,
  })

  // The lecture is still drawn with the version it pinned: the words are
  // exactly where they were, under a box name the template no longer has.
  await page.reload()
  await expect(page.getByTestId('slide')).toContainText(
    'A wave that stays in place.',
  )

  // ---- The offer, and its warning ----
  await openDesignTab(page)
  await expect(page.getByText('This design has been updated')).toBeVisible()
  await page.getByRole('button', { name: 'Update this lecture' }).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  // Renaming a box pairs it by kind, so nothing is stranded and the dialog
  // says so rather than warning about content it is not going to lose.
  await expect(dialog).toContainText('Nothing is deleted.')

  // ---- Taking it moves the content onto the renamed box ----
  await dialog.getByRole('button', { name: 'Update this lecture' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('This design has been updated')).toBeHidden()

  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.reload()
  await expect(page.getByTestId('slide')).toContainText(
    'A wave that stays in place.',
  )

  // Reopening confirms the offer is spent, not merely hidden.
  await openDesignTab(page)
  await expect(page.getByText('This design has been updated')).toBeHidden()
})
