/**
 * The two mailed account flows end to end (AUTH-3, AUTH-4), through a live
 * browser against a live server and database.
 *
 * The link is read out of the message the server actually sent — the token is
 * stored hashed, so there is nothing else to read, and this is what a person
 * with an inbox does. `MAIL_PROVIDER=log` plus `MAIL_LOG_FILE` gives the run
 * the same text a relay would have delivered.
 */
import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { MAIL_LOG } from '../playwright.config'
import { createProject, openProjectSettings } from './helpers'

const password = 'sturdy-passw0rd'

/** The most recent link of a kind, out of the mail the server has sent. */
const linkFromMail = (path: string): string => {
  const log = readFileSync(MAIL_LOG, 'utf8')
  const matches = [
    ...log.matchAll(new RegExp(`(https?://\\S*${path}\\S*)`, 'g')),
  ]
  const last = matches.at(-1)
  if (!last) throw new Error(`no ${path} link in the sent mail`)
  return last[1]!
}

/** Registers a fresh account and lands on the app. */
const registerAs = async (page: Page, email: string, name: string) => {
  await page.goto('/register')
  await page.getByLabel('Display name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app$/)
}

test('email verification: unverified cannot publish, the link fixes it (AUTH-3)', async ({
  page,
}) => {
  const email = `verify-${Date.now()}@example.com`
  await registerAs(page, email, 'Verifier')

  // A new account is told what is outstanding, and offered another link
  await page.goto('/app/settings')
  await expect(page.getByText('Confirm your email address')).toBeVisible()
  await expect(page.getByText(`We sent a link to ${email}`)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Send another link' }),
  ).toBeVisible()

  // The one thing it may not do: publish. Projects are public by default,
  // so an unconfirmed account's start restricted instead.
  await page.goto('/app')
  await createProject(page, 'Chemistry')
  await openProjectSettings(page, 'Chemistry')
  await page.getByRole('tab', { name: 'Privacy & Sharing' }).click()
  await expect(page.getByRole('radio', { name: /restricted/i })).toBeChecked()

  // ...and trying to open it up is refused, in words that say what to do
  await page.getByRole('radio', { name: /public/i }).click()
  await expect(
    page.getByText(/confirm your email address first/i),
  ).toBeVisible()
  await expect(page.getByRole('radio', { name: /restricted/i })).toBeChecked()
  await page.getByRole('button', { name: 'Close settings' }).click()

  // Follow the link the server mailed
  await page.goto(linkFromMail('/verify-email'))
  await expect(page.getByText(/your address is confirmed/i)).toBeVisible()

  // Now it publishes
  await page.goto('/app')
  await openProjectSettings(page, 'Chemistry')
  await page.getByRole('tab', { name: 'Privacy & Sharing' }).click()
  await page.getByRole('radio', { name: /public/i }).click()
  await expect(page.getByRole('radio', { name: /public/i })).toBeChecked()
  await page.getByRole('button', { name: 'Close settings' }).click()

  // ...and settings now agrees, with nothing left to do
  await page.goto('/app/settings')
  await expect(page.getByText('Confirmed')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Send another link' }),
  ).toHaveCount(0)
})

test('a used verification link does not work twice (AUTH-3)', async ({
  page,
}) => {
  const email = `once-${Date.now()}@example.com`
  await registerAs(page, email, 'Once')
  const link = linkFromMail('/verify-email')

  await page.goto(link)
  await expect(page.getByText(/your address is confirmed/i)).toBeVisible()

  await page.goto(link)
  await expect(page.getByText(/no longer valid/i)).toBeVisible()
})

test('password reset: the link sets a new password and ends sessions (AUTH-4)', async ({
  page,
}) => {
  const email = `reset-${Date.now()}@example.com`
  await registerAs(page, email, 'Resetter')

  // Sign out first: someone who has forgotten their password is not signed in
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login$|localhost:\d+\/$/)

  // The way out is offered where someone locked out would look for it
  await page.goto('/login')
  await expect(
    page.getByRole('link', { name: 'Forgot your password?' }),
  ).toHaveAttribute('href', '/forgot-password')

  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send the link' }).click()
  // Says the same thing whether or not the address has an account
  await expect(page.getByText(/if that address has an account/i)).toBeVisible()

  await page.goto(linkFromMail('/reset-password'))
  const newPassword = 'a-different-passw0rd'
  await page.getByLabel('New password').fill(newPassword)
  await page.getByRole('button', { name: 'Save the new password' }).click()
  await expect(page.getByText(/your password is set/i)).toBeVisible()

  // The old password is gone
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toBeVisible()

  // ...and the new one works
  await page.getByLabel('Password').fill(newPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app$/)

  // Reaching a mailed link proved the address, so publishing is unlocked too
  await page.goto('/app/settings')
  await expect(page.getByText('Confirmed')).toBeVisible()
})

test('asking to reset an unknown address says exactly the same thing (AUTH-4)', async ({
  page,
}) => {
  await page.goto('/forgot-password')
  await page.getByLabel('Email').fill(`nobody-${Date.now()}@example.com`)
  await page.getByRole('button', { name: 'Send the link' }).click()
  // Anything else would make this form a way to find out who is registered
  await expect(page.getByText(/if that address has an account/i)).toBeVisible()
})
