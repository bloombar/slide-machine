/**
 * AudioWorklet processor for Google Cloud STT: downsamples the mic's Float32
 * frames to the configured capture rate, converts them to 16-bit little-endian
 * PCM (LINEAR16 — the format the streaming adapter configures), and posts
 * batched buffers to the main thread, which forwards them over the WebSocket.
 * Batching keeps the socket from sending a frame every ~3 ms.
 *
 * The batch is sized by DURATION, not by a fixed sample count: a fixed count
 * would silently buffer proportionally longer at a lower capture rate (2048
 * samples is 43 ms at 48 kHz but 128 ms at 16 kHz), delaying every transcript
 * and every generated slide by the difference. Deriving it from the output rate
 * pins the frame interval no matter how STT_CAPTURE_SAMPLE_RATE is set.
 *
 * Downsampling (CAP-3): browsers capture at their hardware rate (typically
 * 48 kHz) but Cloud STT models are trained at 16 kHz, so streaming native rate
 * triples the bytes — socket traffic, server-side retention memory, and stored
 * WAV size — for no transcription benefit. `processorOptions.targetSampleRate`
 * sets the rate; the main thread reports the SAME effective rate to the server
 * so the PCM is interpreted correctly.
 *
 * Each output sample is the MEAN of the input samples it spans, not a dropped
 * sample: averaging is a cheap low-pass that keeps decimation from aliasing
 * high frequencies down into the speech band. Because the ratio need not be an
 * integer (44.1 kHz → 16 kHz is 2.756…), the window width alternates between
 * floor and ceil of the ratio, which holds the output rate exact over time.
 */
/* global AudioWorkletProcessor, registerProcessor, sampleRate */

/** Audio per posted frame. Low enough to stay responsive, high enough that the
 * socket isn't sending a frame per render quantum; ~100 ms is the usual
 * streaming-STT ceiling, so this sits comfortably under it. */
const BATCH_MS = 40
/** Floor on batch size (one render quantum), so no configured rate can make
 * the worklet post a frame per process() call. */
const MIN_BATCH_SAMPLES = 128

/** Scales a clamped float sample to the signed 16-bit range. */
const toInt16 = value => {
  const clamped = Math.max(-1, Math.min(1, value))
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
}

class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const opts = (options && options.processorOptions) || {}
    // `sampleRate` is the AudioWorkletGlobalScope's context rate; taking it
    // from options too keeps the processor testable outside an AudioWorklet.
    const inputRate =
      opts.inputSampleRate > 0
        ? opts.inputSampleRate
        : typeof sampleRate === 'number'
          ? sampleRate
          : 48000
    const target = opts.targetSampleRate > 0 ? opts.targetSampleRate : inputRate
    // Never upsample: a context already at or below the target streams as-is.
    const outputRate = target < inputRate ? target : inputRate
    this.ratio = inputRate / outputRate
    // Frame size in OUTPUT samples, so each post carries BATCH_MS of audio
    // whatever the rates are.
    this.batchSamples = Math.max(
      MIN_BATCH_SAMPLES,
      Math.round((outputRate * BATCH_MS) / 1000),
    )
    this.buffer = new Int16Array(this.batchSamples)
    this.offset = 0
    // Box-filter state: running sum of the current output sample's window.
    this.sum = 0
    this.count = 0
    this.spanned = 0
  }

  /** Appends one converted sample, posting the batch once it is full. */
  emit(value) {
    this.buffer[this.offset++] = toInt16(value)
    if (this.offset === this.batchSamples) {
      const chunk = this.buffer.slice(0, this.offset)
      this.port.postMessage(chunk.buffer, [chunk.buffer])
      this.offset = 0
    }
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i]
      if (this.ratio === 1) {
        this.emit(sample)
        continue
      }
      this.sum += sample
      this.count++
      this.spanned++
      // One output sample per `ratio` inputs on average; carrying the
      // remainder forward (rather than resetting to 0) is what keeps a
      // fractional ratio from drifting.
      if (this.spanned >= this.ratio) {
        this.emit(this.sum / this.count)
        this.spanned -= this.ratio
        this.sum = 0
        this.count = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-processor', PcmProcessor)
