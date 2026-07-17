/**
 * A single-producer/single-consumer async queue that bridges push-based
 * callbacks (e.g. gRPC 'data' events) to the pull-based AsyncIterable a
 * TranscriptionStream exposes. Shared by transcription adapters.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private resolvers: ((result: IteratorResult<T>) => void)[] = []
  private done = false

  /** Enqueue a value (or hand it directly to a waiting consumer). */
  push(value: T): void {
    if (this.done) return
    const resolve = this.resolvers.shift()
    if (resolve) resolve({ value, done: false })
    else this.values.push(value)
  }

  /** Complete the iterable; pending and future consumers get `done`. */
  close(): void {
    this.done = true
    let resolve
    while ((resolve = this.resolvers.shift()))
      resolve({ value: undefined as never, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift()
        if (value !== undefined) return Promise.resolve({ value, done: false })
        if (this.done)
          return Promise.resolve({ value: undefined as never, done: true })
        return new Promise(resolve => this.resolvers.push(resolve))
      },
    }
  }
}
