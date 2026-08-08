/**
 * Shared fixtures for the integration suite.
 *
 * Forty-two of these files each define their own identical `registerUser` and
 * `act`. Sweeping them all is a mechanical diff that would conflict with
 * every migration commit, so it is deliberately left for later — but new
 * files should not add copies forty-three onward. Import these instead.
 *
 * Convention the suite already follows: `ada` owns things, `bob` is the
 * stranger, and a third name appears when a viewer/editor distinction matters.
 */
import request from 'supertest'
import type { Server } from 'node:http'
import { createApp } from '../../../src/app'
import { UserModel } from '../../../src/models/user'

/**
 * One long-lived server per file. Supertest's default per-request ephemeral
 * servers intermittently lost requests to localhost port churn on macOS.
 */
export const startServer = (): Server => createApp().listen(0)

/**
 * Registers an account and returns its access token, with the address already
 * confirmed — publishing needs a verified address (AUTH-3), and no test that
 * is about something else should have to walk the email flow to get there.
 */
export const registerUser = async (
  server: Server,
  email: string,
): Promise<string> => {
  const res = await request(server)
    .post('/api/auth/register')
    .send({ email, password: 'longenough1', displayName: email.split('@')[0] })
  if (res.status !== 201) {
    throw new Error(`registration failed for ${email}: ${res.status}`)
  }
  await UserModel.updateOne({ email }, { emailVerified: true })
  return res.body.accessToken as string
}

/** Dispatches an action as `token`, returning the supertest response. */
export const act = (
  server: Server,
  token: string,
  name: string,
  input: object = {},
) =>
  request(server)
    .post(`/api/actions/${name}`)
    .set('Authorization', `Bearer ${token}`)
    .send(input)

/** Dispatches an action with no credentials at all. */
export const actAnonymously = (
  server: Server,
  name: string,
  input: object = {},
) => request(server).post(`/api/actions/${name}`).send(input)
