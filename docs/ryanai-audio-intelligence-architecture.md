# RyanAI Audio Intelligence Architecture

Status: proposed architecture and implementation contract. This document does not claim provider integration, model availability, language coverage, or production verification.

## Objective

Build one secure audio platform for audio-to-text (A2T), speech-to-text (S2T), text-to-speech (TTS), and long-form audiobook production. Reuse shared ingestion, language metadata, identity, storage, job orchestration, and audit controls without conflating their distinct tasks.

The Fish Audio Drama 3 announcement is a product-direction reference for expressive control (word-level delivery, tone changes, and voice transitions). It is not evidence that Drama 3 is generally available, that RyanAI has access, or that its API contract is known. Implement a provider-neutral adapter and add a Fish Audio adapter only after official API documentation, account access, licensing, and a sandbox test are verified.

## Capability boundaries

- **A2T — audio-to-text:** ingest an audio asset and produce a durable transcript, optionally with timestamps, speaker labels, language detection, confidence, and structured segments.
- **S2T — speech-to-text:** recognize live microphone/telephony speech and return interim/final transcript events. Reuse transcript normalization and language metadata from A2T, but preserve streaming lifecycle, latency, interruption, and partial-result semantics.
- **TTS — text-to-speech:** render text or annotated scripts to audio. Support voice selection, locale, speaking rate, pauses, pronunciation hints, emphasis, emotion/style where supported, and safe voice transitions.
- **Audiobook production:** transform a manuscript into a versioned project with chapters, narration segments, character/voice assignments, pronunciation lexicon, generated audio, review notes, and final export. This is a workflow built on A2T/TTS, not a single model call.

## Target architecture

1. **Authenticated Audio API** — owner/user-scoped endpoints; short-lived upload tickets; strict content-type, duration, size, and quota limits.
2. **Private asset storage** — private object storage only; signed URLs with short expiry; encryption at rest; no public buckets or permanent public media URLs.
3. **Durable job queue** — persist job and idempotency key before acknowledging; bounded concurrency; retries with backoff; lease/heartbeat; dead-letter state; cancellation; recovery after worker restart.
4. **Audio orchestration service** — validates requests, chooses a configured provider by capability, applies policy, and normalizes results. Provider secrets remain server-side.
5. **Provider adapters** — independent interfaces for transcription, streaming recognition, synthesis, and optional diarization. Never assume feature parity between providers.
6. **Transcript and audiobook persistence** — PostgreSQL stores metadata, job state, segment timing, speaker/voice assignments, revisions, and audit events; audio bytes remain in private object storage.
7. **Review and playback UI** — chapter/segment editor, synchronized transcript/audio playback, word/segment re-render, compare revisions, accessibility controls, and export status.

## Provider-neutral contracts

Define separate typed contracts rather than one generic "audio model":

- `TranscriptionProvider.transcribe(asset, options)` returns normalized text, detected locale, segments, timestamps, speaker IDs when available, and provider confidence metadata.
- `StreamingRecognitionProvider.openSession(options)` emits partial, final, error, and closed events; supports explicit stop/cancel and bounded session duration.
- `SynthesisProvider.synthesize(script, voice, renderOptions)` returns an audio artifact plus duration, format, locale, and supported-control metadata.
- `SynthesisProvider.capabilities()` declares supported locales, voices, emotion/style controls, word-level controls, voice switching, streaming, and output formats. Unsupported controls must be rejected or clearly reported as ignored; never silently promise them.

Keep provider-native payloads behind adapters. Do not expose raw vendor errors, keys, or internal URLs to clients.

## Expressive narration and Drama-style controls

Represent narration as a structured script, not plain text with undocumented markup. Each segment should include:

- stable segment ID and source text;
- optional speaker/character ID and voice profile reference;
- locale and pronunciation dictionary references;
- delivery annotations such as neutral, warm, excited, concerned, whisper, or emphasis, only where the selected provider explicitly supports them;
- pause and pacing hints;
- optional word-level overrides with exact source offsets;
- continuity metadata to preserve character identity across chapters.

Voice changes must occur at explicit segment/word boundaries. Validate offsets against normalized text; reject overlapping or out-of-range annotations. Maintain a preview/re-render workflow so users can regenerate one segment without rebuilding the entire book. Store provider, model/version, voice ID, settings, and source revision for reproducibility.

Do not clone or imitate a real person's voice without documented, explicit consent and applicable rights. Require user confirmation for custom voice enrollment, retain consent evidence, and provide deletion/revocation. Block deceptive impersonation and unauthorized public-figure voice cloning.

## Audiobook workflow

1. Create a private audiobook project and upload manuscript/audio sources.
2. Extract text from supported documents; run A2T for source recordings where requested.
3. Split manuscript into chapters and manageable narration segments while preserving paragraph and sentence boundaries.
4. Let the user assign narrator/character voices, locale, pronunciation lexicon, and delivery notes.
5. Generate a short preview and require approval before bulk rendering.
6. Render chapters as durable asynchronous jobs with per-segment retries and idempotency.
7. Review transcript alignment, pronunciation, pacing, clipping, silence, and voice continuity.
8. Re-render selected segments; preserve previous revisions.
9. Assemble chapter audio and metadata; export only after validation.
10. Provide resumable downloads and playback, plus project deletion and retention controls.

Recommended initial export targets: MP3 and WAV; add M4B/chapters/bookmarks only with a tested packaging implementation. Do not label a book "complete" until every required chapter has a successful artifact and quality checks pass.

## A2T/S2T quality requirements

- Explicit locale selection with optional detection; do not infer that language-selector availability means model support.
- Preserve timestamps and original segment order; mark uncertain words rather than inventing them.
- Support South African English (en-ZA) as a priority and treat Tshivenda (ve-ZA) as a separately verified capability. Do not claim Venda recognition or synthesis until a real configured provider passes native-speaker evaluation.
- Keep speaker diarization optional and confidence-labelled; never equate a speaker label with a verified identity.
- Normalize punctuation and whitespace without changing meaning; retain raw provider transcript for audit/review.
- Handle silence, noise, clipping, long recordings, mixed-language speech, and low-confidence audio with explicit outcomes.
- For live S2T, distinguish interim text from committed final text and avoid duplicate transcript insertion on reconnect.

## Security, privacy, and abuse controls

- Require authenticated sessions and server-side authorization for every upload, job, read, playback, export, and delete operation.
- Use short-lived, single-purpose upload/download URLs; verify ownership again when issuing them.
- Enforce MIME sniffing, extension allowlists, file-signature checks, duration and byte limits, decompression limits, and malware scanning before processing.
- Treat audio and transcripts as untrusted user content. Never execute instructions embedded in recordings or transcripts; do not let transcription trigger tools or outbound communication without a separate authenticated intent and approval gate.
- Redact secrets and personal data from logs; never log raw audio, full transcripts, signed URLs, or provider credentials by default.
- Apply per-user quotas, rate limits, spend ceilings, maximum concurrent jobs, and maximum session duration.
- Verify provider webhook signatures and use replay protection where callbacks exist.
- Define retention periods and deletion propagation across object storage, derived transcripts, caches, provider retention settings, and backups.
- Keep external provider calls disabled in CI. Use deterministic mocked adapters for unit tests and explicitly authorized sandbox credentials for integration tests.
- Record consent, provider/model version, job transitions, access, export, and deletion in an append-only audit trail.

## Observability and truthful status

Expose states such as queued, validating, processing, review_required, completed, failed, cancelled, and expired. "Configured" means required settings exist; "connected" requires a live authenticated health check; "verified" requires a reproducible capability test. Never report success from a queued response or provider acceptance alone.

Track latency, audio duration, transcription error rate, word error rate on consented evaluation sets, synthesis failure rate, cost per audio minute, queue age, retries, and cancellation. Do not store raw audio in telemetry.

## Implementation sequence

**Phase 0 — inventory and contracts:** locate existing audio routes, attachments, voice UI, provider clients, database models, storage policies, and tests. Document current behavior and gaps. No provider switch or deployment.

**Phase 1 — secure shared foundation:** typed contracts, validation, private asset handling, durable job records, authorization, quotas, audit events, and deterministic adapter tests.

**Phase 2 — A2T and S2T:** implement batch transcription and streaming recognition with normalized transcript events, timestamps, cancellation, reconnect behavior, and en-ZA evaluation.

**Phase 3 — audiobook workspace:** project/chapter/segment persistence, editor, review, preview, revision history, and export validation.

**Phase 4 — expressive TTS:** capability-aware synthesis adapter, structured delivery annotations, per-segment generation, voice continuity, and explicit consent protections.

**Phase 5 — provider evaluation:** compare configured providers (including Fish Audio only if officially accessible) on licensing, data handling, latency, cost, voice quality, word-level controls, voice switching, locale support, and operational reliability. Select by measured capability, not announcement claims.

**Phase 6 — release gates:** full frontend/backend tests, migration and storage-policy verification, security review, cost/quota tests, native-speaker evaluation, and end-to-end tests using authorized sandbox accounts. Keep production activation behind explicit approval.

## Acceptance criteria

- A2T and S2T have separate APIs and lifecycle tests while sharing transcript normalization.
- Streaming partial/final results are not duplicated and stop/cancel reliably closes sessions.
- Unauthorized users cannot access another user's audio, transcript, job, or export.
- Oversized, spoofed, malformed, and unsupported media are rejected before provider submission.
- Jobs survive worker restart and do not create duplicate billable renders on retry.
- Every audiobook chapter and segment has traceable source revision, provider/model, voice, and render status.
- Word-level delivery and mid-sentence voice changes are capability-gated and tested; unsupported providers reject the feature clearly.
- No voice cloning path exists without explicit consent and rights verification.
- en-ZA is evaluated with a documented test set; ve-ZA is marked unsupported until separately verified.
- CI uses mocks only; live provider calls, production credentials, deployments, and paid upgrades require separate authorization.
