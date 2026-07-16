/**
 * AudioWorklet processor for Google Cloud STT: converts the mic's Float32
 * frames to 16-bit little-endian PCM (LINEAR16 — the format the streaming
 * adapter configures) and posts batched buffers to the main thread, which
 * forwards them over the WebSocket. Batching keeps the socket from sending a
 * frame every ~3 ms.
 */
/* global AudioWorkletProcessor, registerProcessor */
const BATCH_SAMPLES = 2048

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Int16Array(BATCH_SAMPLES)
    this.offset = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i++) {
      // Clamp to [-1, 1] then scale to the signed 16-bit range.
      const sample = Math.max(-1, Math.min(1, channel[i]))
      this.buffer[this.offset++] =
        sample < 0 ? sample * 0x8000 : sample * 0x7fff
      if (this.offset === BATCH_SAMPLES) {
        const chunk = this.buffer.slice(0, this.offset)
        this.port.postMessage(chunk.buffer, [chunk.buffer])
        this.offset = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-processor', PcmProcessor)
