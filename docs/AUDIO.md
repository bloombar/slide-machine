# Lecture audio

How spoken audio gets from a microphone to a transcript, a slide, a stored
recording, and eventually a speaker label. This is the behaviour map; the _why_
is in [DECISIONS.md](DECISIONS.md) (the 2026-07-30 entries), the requirements in
[SPEC.md](SPEC.md) CAP-3 / GEN-4 / P-6, and deployment in [DEPLOY.md](DEPLOY.md).

```text
mic ─▶ worklet ─▶ WebSocket ─▶ Cloud STT ─▶ transcript ─▶ session.phrase ─▶ slide
       (24 kHz)      │
                     └─▶ retention tee ─▶ streaming upload ─▶ audio/<deck>/<id>.pcm
                                                                   │
                                            playback (ranged read) ◀┤
                                            diarization (batch) ───◀┘
```

Only the **google-cloud** speech engine reaches the server. With
`TRANSCRIPTION_PROVIDER=browser` the audio never leaves the browser, so nothing
below applies — no recording, no diarization.

## 1. Capture and downsampling (client)

[stt/capture.ts](../client/src/stt/capture.ts) opens the mic and an
`AudioWorkletNode`; [stt/pcm-worklet.js](../client/src/stt/pcm-worklet.js)
converts float frames to 16-bit little-endian PCM and posts batches to the main
thread, which forwards them over the WebSocket.

- **Rate.** Browsers capture at their hardware rate (usually 48 kHz). The
  worklet downsamples to `STT_CAPTURE_SAMPLE_RATE`, default **24 kHz** — half
  the bytes of native capture, with no measured effect on transcription. A
  context already at or below the target streams natively; we never upsample,
  and `0` disables downsampling.
- **Why 24 and not 16.** Cloud STT models are trained at 16 kHz, so 16 would be
  the cheapest rate that costs transcription nothing. But the same recording is
  played back per slide, and 16 kHz reproduces nothing above 8 kHz — where the
  sibilance of "s" and "f" lives — so speech stays perfectly intelligible and
  sounds dull. 24 kHz keeps that for half the cost of 48 kHz. Drop to `16000`
  if playback fidelity does not matter; only the recordings change. Note this
  is coupled to `AUDIO_RETENTION_MAX_SESSION_MB`: a higher rate fills the
  per-session cap sooner (~1 h 49 min at 24 kHz, ~2 h 44 min at 16 kHz).
- **Anti-aliasing.** Each output sample is the _mean_ of the inputs it spans.
  Dropping samples instead would alias high frequencies into the speech band.
- **Framing.** Frames carry a fixed **40 ms** of audio, derived from the output
  rate rather than a fixed sample count, so pacing does not change when the
  rate does.
- **Reported rate.** The `start` message carries the rate actually streamed.
  Cloud STT reads the PCM at whatever rate it is told, so this must match.

The rate is published to the client by `GET /api/config`, so changing it is a
server flip and a page reload — no client rebuild.

## 2. Transport and transcription (server)

[ws/audio-socket.ts](../server/src/ws/audio-socket.ts) accepts the socket at
`/api/stt`, authenticating on the upgrade (browsers cannot set headers on a
WebSocket, so the access token rides in `?token=`). It relays frames to the
active `TranscriptionProvider` and pushes interim/final transcripts back.

The socket is a **pure relay**: final phrases reach the client exactly as the
browser engine's do, so slide generation stays client-driven through
`session.phrase`. [google-cloud-transcription.ts](../server/src/providers/google-cloud-transcription.ts)
recycles the underlying gRPC stream every 240 s (under Google's ~305 s cap) and
keeps word offsets absolute across restarts.

## 3. Recording (retention)

Off unless `AUDIO_RETENTION_ENABLED=true`. When on, and the client named a deck
and session, frames are **teed to a streaming upload** as they arrive — nothing
accumulates in the process, so a three-hour lecture costs the same memory as a
three-minute one (measured: no RSS growth above baseline over a four-minute
recording).

Order of operations matters:

1. The session reserves one in-flight upload window (~11 MB) from the
   process-wide budget ([ws/retention-budget.ts](../server/src/ws/retention-budget.ts)).
   If the budget is spent, the session transcribes **without** retaining.
2. The user's **edit access to the deck is verified before the first byte is
   uploaded**. Bytes sent to a bucket cannot be un-sent, so nothing is written
   for a user who may not edit the lecture. Frames arriving during the check
   wait in a small bounded buffer; a slow database degrades retention, not the
   process.
3. Frames stream out. If the upload falls behind (`write` reports
   back-pressure) or the per-session storage cap is hit, the session stops
   copying audio and keeps transcribing.
4. On close the upload completes and a `recordings[]` entry is written to the
   deck (`sessionId`, `audioKey`, `sampleRate`, `durationMs`). On denial,
   error, or an empty session the upload is aborted and nothing persists.

**Transcription, generation, and the transcript are never affected by any of
this.** Every retention failure mode costs only the audio copy.

## 4. Storage format

Recordings are **raw LINEAR16 mono PCM** at `audio/<deckId>/<uuid>.pcm` — no
WAV container, because a header must state a length that is unknown until the
lecture ends and a multipart upload's first part cannot be patched afterwards.
`sampleRate` on the recording is what readers use.

Recordings retained before 2026-07-30 are `.wav` (44-byte header, same PCM
after it). Playback and diarization read both until those age out.

The raw audio is **never exposed in a DTO** and never served via `publicUrl`;
it is reachable only through the authenticated per-slide endpoint.

## 5. Playback

`GET /api/slides/:slideId/audio` stitches a slide's own timed transcript
segments into one clip ([lib/slide-audio.ts](../server/src/lib/slide-audio.ts)),
gated to users who can edit the deck (it holds student voices).

Each segment is fetched as a **byte range**, not by downloading the recording —
a slide's audio is seconds long and the recording behind it can be hours. The
response is wrapped in a real WAV so a browser can play it.

## 6. Diarization

Real-time streaming cannot diarize, so it runs after the lecture:
`deck.diarize` ([actions/reconcile.ts](../server/src/actions/reconcile.ts))
hands each recording to the `DiarizationProvider`, which copies the audio to
GCS (Google `BatchRecognize` reads only from `gs://`), runs a batch job with
speaker labels and word offsets, deletes its GCS copy, and time-joins the
speaker intervals onto the transcript segments.

Because raw PCM carries no format, the adapter states it explicitly
(`explicitDecodingConfig`: LINEAR16, the recording's `sampleRate`, 1 channel);
legacy `.wav` recordings keep auto-decoding. Both paths are verified against
the live service.

## 7. Lifecycle

A daily sweep ([jobs/audio-cleanup.ts](../server/src/jobs/audio-cleanup.ts))
deletes expired recordings — the audio object _and_ its deck reference, so
storage and the database stay consistent. Deleting a project, lecture, or user
cascades to their recordings.

**How long a recording lives is per lecture owner.** Each plan tier sets its own
`audioRetentionDays` in [config/plans.json](../config/plans.json) (BILL-3), and
`AUDIO_RETENTION_DAYS` applies on top; the **shorter of the two wins**, so a
deployment can tighten the window but never loosen a tier's. `0` for
`AUDIO_RETENTION_DAYS` still means what it always has — the sweep is off and
nothing is deleted, tiers included.

Retained audio also counts against the owner's `audioStorageMb` allowance, which
is a **stock rather than a per-period total**: it is charged when a recording
lands, credited back when the sweep or a deletion removes it, and never reset by
a billing period. An owner whose storage is full still gets a transcript — the
lecture simply is not recorded.

---

## Server configuration

Everything below lives in `server/.env` (see
[.env.example](../server/.env.example) for the annotated set).

**Required for any server-side audio:**

| Variable | Value | Notes |
| --- | --- | --- |
| `TRANSCRIPTION_PROVIDER` | `google-cloud` | `browser`/`none` keep audio in the browser entirely |
| `GOOGLE_APPLICATION_CREDENTIALS` _or_ `GOOGLE_APPLICATION_CREDENTIALS_JSON` | service-account key | Streaming STT **rejects API keys** — it needs a service account. Inline JSON for hosts with no key file. See [GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md) |
| `STT_CAPTURE_SAMPLE_RATE` | `24000` (default) | 8000–48000, or `0` for no downsampling |

**Required to keep recordings:**

| Variable | Default | Notes |
| --- | --- | --- |
| `AUDIO_RETENTION_ENABLED` | `false` | Master switch |
| `AUDIO_RETENTION_DAYS` | `30` | Deployment-wide ceiling on the window; the owner's tier may be shorter and then wins. `0` = sweep off, keep forever |
| `AUDIO_RETENTION_MAX_SESSION_MB` | `300` | How much **one** lecture may store (~1 h 49 min at 24 kHz). Past it the recording is truncated; `0` = uncapped |
| `AUDIO_RETENTION_MAX_TOTAL_MB` | `128` | **Memory** ceiling across concurrent recordings (~11 MB each), so ≈ how many may record at once. Size to the host's RAM; `0` = uncapped |
| `STORAGE_PROVIDER` | `local` | `s3` for any real deployment |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | — | Spaces endpoint, region, Space name |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | Spaces key pair |
| `S3_FORCE_PATH_STYLE` | `false` | `true` is MinIO-only; Spaces uses virtual-hosted |

**Required for diarization:**

| Variable | Notes |
| --- | --- |
| `DIARIZATION_PROVIDER=google-cloud` | `none` (default) leaves segments untagged |
| `GCS_AUDIO_BUCKET` | A **Google Cloud Storage** bucket — not the Space. BatchRecognize reads only from `gs://` |
| `DIARIZATION_LOCATION` | Default `us`; `us` or `eu` only. Chirp 3 exists in those **multi-regions**, not regional endpoints like `us-central1` |

Remember the `0` convention: for the rate, the retention days, and both
ceilings, `0` means _no limit_ — it removes a bound and costs more, not less.

## DigitalOcean Spaces setup

Beyond creating the Space and a key pair ([DEPLOY.md §2](DEPLOY.md)):

1. **Add an `AbortIncompleteMultipartUpload` lifecycle rule — required.**
   Streaming uses multipart uploads. One interrupted by a crash or a dropped
   connection leaves parts that consume paid storage and do **not** appear in
   object listings, so the cost is invisible. The app aborts explicitly on every
   failure path it can see, but a killed process cannot clean up after itself.

   Spaces supports this (confirmed). Set it with a **full-access Spaces key** —
   the app's own key is denied bucket-lifecycle operations, which is fine, since
   it never needs them:

   ```jsonc
   // s3api put-bucket-lifecycle-configuration
   { "Rules": [{ "ID": "abort-incomplete-mpu", "Status": "Enabled",
                 "Filter": { "Prefix": "" },
                 "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 } }] }
   ```

   Two traps. **`put-bucket-lifecycle-configuration` replaces the entire
   configuration** — read the current rules first and write back the merged set,
   or you will silently drop the `audio/` expiry below. And **AWS CLI v2 cannot
   display the response**: Spaces returns the rule in the legacy form with an
   empty `<Prefix></Prefix>`, which parses to `None` and crashes the CLI's
   formatter with `argument of type 'NoneType' is not a container or iterable`.
   That error is cosmetic — the rule is applied. Use the maintenance script
   below instead of the CLI; it reads the response correctly and merges rather
   than replacing.

2. **Optionally expire the `audio/` prefix.** A lifecycle expiration rule
   scoped to `audio/` is a zero-code backstop to the app's sweep. **Scope it to
   `audio/`** — an unprefixed rule would also expire slide images (`slides/`),
   narration (`tts/`), and seed files (`seed/`). It is blind to the database and
   can leave a dangling reference, so the app-side sweep stays the source of
   truth.

3. **Key permissions.** The app needs object read/write/delete plus
   `ListMultipartUploads` and `AbortMultipartUpload` on the Space. It does
   _not_ need — and observably does not have — bucket creation or lifecycle
   configuration.

## Maintaining the bucket

[`scripts/spaces/lifecycle.mjs`](../scripts/spaces/lifecycle.mjs) does all of
the above without the CLI's formatting bug, and reports rather than assumes —
"could not read the rules" is distinguished from "no rule exists", because
mistaking one for the other leads to re-applying a rule that is already there.

```sh
# report: which rules exist, and any stranded uploads
npm run spaces:lifecycle -- --env-file server/.env.production

# add or refresh the abort rule, preserving every other rule
npm run spaces:lifecycle -- --env-file server/.env.production --apply-abort-rule

# clear uploads stranded by an unclean shutdown (skips recent ones)
npm run spaces:lifecycle -- --env-file server/.env.production --abort-orphans
```

Lifecycle calls need a full-access key; an exported `S3_ACCESS_KEY_ID` /
`S3_SECRET_ACCESS_KEY` overrides whatever the `--env-file` supplies, so the file
can still provide the endpoint and bucket. The script refuses to write when it
cannot read the current configuration, and `--abort-orphans` leaves uploads
younger than an hour alone — a lecture in progress holds one open, and aborting
it destroys that recording.

Verified against Spaces: multipart uploads complete byte-identically and the
AWS SDK's default checksum headers are accepted, so no
`requestChecksumCalculation` override is needed.

## Known limits

- **A crash loses that session's audio.** Uploaded parts are unreachable
  without the upload id, which is not persisted. Resumability would require
  storing the id and part list.
- **Slides past a truncated recording still offer playback.** A per-session cap
  or a back-pressure stop truncates the audio, but `audioSlideIds` matches on
  session id rather than on the retained duration, so the option appears and the
  request 404s. It fails safely — the range read clamps, producing no audio
  rather than the wrong audio.
- **Audio objects are stored `public-read`** like every other object, protected
  only by unguessable keys. They are never linked, but making the `audio/`
  prefix private is unfinished work.
