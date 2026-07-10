/**
 * Dispatches a TECH-13 action by name via POST /api/actions/:name.
 */
import { apiFetch } from './http'

export const dispatchAction = <T>(
  name: string,
  input: object = {},
): Promise<T> =>
  apiFetch<T>(`/api/actions/${name}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
