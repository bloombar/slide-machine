/**
 * Startup reporting for the HTTP server's bind.
 *
 * Express 5 hands a bind failure to the very callback it uses to announce a
 * successful listen — `app.listen` registers that callback as a one-shot
 * `error` handler as well. A callback that ignores its argument therefore
 * announces "listening" on a port it never got, swallows the error (an
 * unhandled `error` event would at least have crashed the process), and leaves
 * the server running with no socket. The symptom surfaces far from the cause:
 * the API is silently unreachable and `npm run dev` stalls until wait-on gives
 * up. Routing the callback through here makes a failed bind loud and fatal.
 */

/** Actionable advice for the bind failures worth explaining by name. */
const adviceFor = (code: string | undefined, port: number): string => {
  switch (code) {
    case 'EADDRINUSE':
      return `port ${port} is already in use by another process. Stop that process, or set PORT in server/.env to a free port.`
    case 'EACCES':
      return `no permission to bind port ${port}. Ports below 1024 need elevation — set PORT in server/.env to a higher port.`
    default:
      return `could not bind port ${port}.`
  }
}

/**
 * Logs the outcome of `app.listen`. Exits non-zero on failure so a broken bind
 * stops the server instead of masquerading as a healthy startup.
 */
export const reportListen = (
  error: Error | undefined,
  port: number,
  nodeEnv: string,
): void => {
  if (!error) {
    console.log(`Slide Machine server listening on port ${port} (${nodeEnv})`)
    return
  }
  const { code } = error as NodeJS.ErrnoException
  console.error(`Server failed to start: ${adviceFor(code, port)}`)
  process.exit(1)
}
