# Interview Mode — Implementation Plan (Phase 2)

> **Status:** Approved for implementation. Design decisions below are LOCKED — do not
> re-litigate them. If something is technically impossible as specified, stop and ask
> before substituting your own design.
>
> **Process:** Work on branch `feat/interview-mode`. Open a PR to `main` when done.
> Do NOT push tags and do NOT trigger a release — the PR gets a human + Claude code
> review first. Bump the version to **7.1.0** (see §9). Run `npm run typecheck`,
> `npm test`, and `npm run build` before opening the PR; all three must pass.

---

## 1. Problem & Goal

This app is a real-time interview co-pilot. The candidate is on a video call, camera
ON, and can only steal 1–2 second glances at the overlay. The interviewer's voice
comes through system audio.

**Today's voice pipeline is strictly sequential and mistimed:**

```
VAD waits for ~1s silence → stop recording → send WHOLE audio blob to Whisper
→ wait for full transcription → THEN the LLM starts → answer arrives
```

- **Fires too early:** interviewers pause >1s mid-question; VAD cuts the question off
  and the AI answers a fragment.
- **Fires too late:** when the question genuinely ends, the user still pays
  silence-detection lag + full-blob STT + LLM first-token, stacked serially.

**Target pipeline (this plan):**

```
Interviewer speaks ──► continuous capture ──► rolling ~4s chunks ──► Groq Whisper per chunk
                                                    │
                                       transcript buffer accumulates (visible live)
                                                    │
        USER hits fire hotkey ─────────────────────►│  (buffer = everything since last fire)
                                                    ▼
                                     LLM streams: SKELETON line first, cue lines after
                                                    │
                                       buffer clears, capture continues
```

**Latency budget:** from hotkey press to first usable text (the `**SAY:**` line)
on screen: **≤ 2 seconds**. Achieved because transcription happened *while* the
interviewer was talking — at fire time only the final partial chunk (≤4s of audio,
~300–600ms on Groq `whisper-large-v3-turbo`) plus LLM first-token remain.

## 2. Locked design decisions

| Decision | Choice |
|---|---|
| Who decides the question is finished | **The user, via a hotkey.** No automatic firing in this mode. |
| STT approach | **Chunked Groq Whisper** — rolling ~4s chunks transcribed during capture. Reuses the existing STT provider config. No new providers. |
| Fire scope | **Everything since the last fire.** Buffer clears on fire. |
| Output format | **Skeleton-first cue cards** (see §7 system prompt). No prose paragraphs. |
| Existing Auto-detect (VAD) and Manual modes | **Unchanged.** Interview mode is a third mode alongside them. |

## 3. Current architecture map (read these before coding)

| Area | File | What it does |
|---|---|---|
| Voice flow hook | `src/hooks/useSystemAudio.ts` | Capture control, STT call, AI call, conversation state, quick actions, `regenerate(lengthId)`, `buildEffectiveSystemPrompt()` (injects active Interview Profile context — resume/JD). |
| Voice panel UI | `src/pages/app/components/speech/index.tsx` | `SystemAudio` component: `ModeSwitcher`, `RecordingPanel`, `ResultsSection`, `SettingsPanel`, `QuickActions`, response-length picker + regenerate button (added v7.0.3). |
| Mode switcher | `src/pages/app/components/speech/ModeSwitcher.tsx` | Currently a boolean toggle mapped to `vadConfig.enabled` (Auto-detect vs Manual). |
| STT | `fetchSTT` in `src/lib/functions/` | Takes `{provider, selectedProvider, audio: Blob}`, returns transcript string. Groq `whisper-large-v3-turbo` is the default provider. |
| AI | `fetchAIResponseWithFailover` in `src/lib/functions/ai-response-failover.ts` | Streaming generator. Params include `systemPrompt`, `segments`, `history`, `userMessage`, `signal`, `_source`, `responseLengthOverride`. |
| Prompt assembly | `buildEnhancedSystemPrompt` in `src/lib/functions/ai-response.function.ts` | Appends response-length tier prompt + markdown instructions to the base system prompt. |
| Length tiers | `src/lib/response-settings.constants.ts` | `RESPONSE_LENGTHS` — tier prompts currently demand prose ("2-4 sentences"), which conflicts with cue-card output. §6 fixes this. |
| Rust capture | `src-tauri/src/speaker/` (`commands.rs`, `windows.rs`, etc.) | WASAPI loopback capture, VAD, continuous mode with `recording-progress` events, `stop_system_audio_capture` / `check_system_audio_access` commands. |
| Global shortcuts | `src-tauri/src/shortcuts.rs` + `src/config/shortcuts.ts` + `src/lib/storage/shortcuts.storage.ts` | Action-id based registry (`system_audio` → ctrl+shift+m, `toggle_window` → ctrl+backslash, …). `handle_shortcut_action()` dispatches; frontend receives events. |
| Prompt Inspector | `src/lib/debug/prompt-capture.ts`, Dev Space page | Captures every outgoing prompt when enabled. Voice flow records with `_source: "audio"`. Use this to verify prompt contents during testing. |

**Critical pre-existing gotchas:**

1. `conversation.messages` in `useSystemAudio.ts` is **newest-first** (new turns are
   *prepended*). Don't assume chronological order.
2. The active-profile context refs (`profileBriefRef` / `profileContextRef`) are loaded
   async on `activeProfileId` change — interview mode MUST route its prompt through
   `buildEffectiveSystemPrompt()` so the resume/JD context is included. Verify via
   Prompt Inspector that a `profileContext` segment is present.
3. On the primary user's machine, `ctrl+shift+a` is held by another application and
   fails to register — do not use it as a default for the new hotkey.
4. Version bumps touch **4 files** (see §9). v7.0.0/v7.0.1 shipped broken because only
   some were bumped.
5. Whisper hallucinates on silence/noise ("Thank you.", "Thanks for watching!", "you").
   The RMS gate in §4 prevents most of it; also drop chunk transcripts that are only
   such junk strings when the chunk was borderline-quiet.

## 4. Work item A — Rust: chunked interview capture

Add a new capture mode to the speaker module. Reuse the existing WASAPI loopback
capture plumbing; do not duplicate device handling.

**New Tauri commands:**

- `start_interview_capture()` — begins continuous loopback capture. No VAD gating of
  the stream (capture everything); the existing noise-gate / RMS machinery is used
  only for the silent-chunk skip below.
- `stop_interview_capture()` — stops capture, discards any partial chunk.
- `flush_interview_chunk()` — immediately emits the current partial chunk (even if
  < chunk duration) and resets the chunk accumulator. Called by the frontend at fire
  time to capture the tail of the question.

**Chunk emission:**

- Accumulate PCM continuously. Every **4000 ms** (constant, e.g. `CHUNK_MS`), take the
  accumulated samples and:
  - Compute RMS. If below a silence floor (reuse/derive from existing
    `noise_gate_threshold`), **skip the emit entirely** (don't waste an STT call), but
    still increment the sequence counter.
  - Otherwise encode as WAV (same format the existing flow sends to STT) and emit a
    Tauri event `interview-audio-chunk` with payload `{ seq: u64, base64: String }`.
- `seq` is monotonically increasing per capture session, including skipped-silent
  chunks, so the frontend can order transcripts and detect gaps.
- Emit `interview-capture-error` with a message string on device failures (mirror the
  existing error-event pattern).

**Note:** simple time-based slicing is acceptable — Whisper tolerates mid-word cuts
well enough for this use case. Do NOT add overlap windows in this phase.

## 5. Work item B — Frontend: transcript buffer + fire flow

Extend `useSystemAudio.ts` (or a colocated helper module if the hook is getting too
large — your call, but keep the public hook surface in one place).

**Mode plumbing:**

- Replace the implicit two-mode boolean with an explicit
  `captureMode: "vad" | "manual" | "interview"` persisted to localStorage. Map the
  legacy `vadConfig.enabled` semantics for backward compatibility (existing users keep
  their mode). `ModeSwitcher.tsx` becomes a three-way switch: **Auto-detect / Manual /
  Interview**.

**Transcript buffer:**

- On `interview-audio-chunk`: enqueue for transcription. Process the queue with
  **concurrency 1** (a 4s chunk transcribes in ~300ms on Groq turbo; a queue depth >2
  means STT is unhealthy — surface a warning in the panel).
- Per chunk: call `fetchSTT` with the existing selected STT provider. On failure,
  retry once, then record the chunk as `[unclear]` and continue. Never block the queue
  on a failed chunk.
- Store results as `{ seq, text }`, render ordered by `seq`. The **buffer** is the
  ordered concatenation of all chunk texts since the last fire.
- Filter junk: if a chunk's transcript, trimmed, is one of the known Whisper
  silence-hallucinations ("Thank you.", "Thanks for watching!", "you", "."), drop it.

**Fire flow (the core interaction):**

1. User triggers fire (hotkey or button).
2. `invoke("flush_interview_chunk")` → await the resulting final chunk's transcription
   (with a ~1.5s timeout — if the flush chunk doesn't arrive in time, fire with what's
   in the buffer; don't stall the user).
3. Assemble `questionText` = ordered buffer text. If empty/whitespace → show a toast
   ("Nothing captured yet") and abort.
4. **Clear the buffer immediately** (capture continues running; new speech starts
   accumulating for the next fire).
5. Set `lastTranscription = questionText` (this keeps the existing
   `regenerate(lengthId)` and quick-actions working unchanged).
6. Call the AI exactly like `processWithAI` does today: through
   `fetchAIResponseWithFailover` with `buildEffectiveSystemPrompt()` output (profile
   context included), conversation history, `_source: "audio"`. Stream into
   `lastAIResponse` as today.
7. Append the user/assistant turn to `conversation` (remember: **prepend**, newest-first).

**Fire hotkey:**

- Add a new global shortcut action `interview_fire`, default **`ctrl+shift+enter`**
  (NOT ctrl+shift+a — see §3 gotcha 3). Register through the existing shortcut
  registry (`src-tauri/src/shortcuts.rs` → `handle_shortcut_action`, plus the frontend
  config in `src/config/shortcuts.ts` and the Shortcuts settings page so it's
  user-rebindable like every other action).
- The Rust handler emits an event the frontend listens for; the frontend runs the fire
  flow. Fire must work while the overlay is unfocused (that's the whole point — the
  user is looking at the meeting app).
- Also add a local key (Enter while the interview panel is focused) and a visible
  **Answer now** button.

## 6. Work item C — Response-length tiers made format-agnostic

The tier prompts in `src/lib/response-settings.constants.ts` currently demand prose
("Limit your answer to 2-4 sentences maximum"), which fights the cue-card system
prompt. Replace the four `prompt` strings so they control *quantity* without dictating
*prose form*. Required wording:

- **auto**: `"IMPORTANT: Match response length to the question's complexity. Simple question → minimal response (2-4 sentences of prose, or 3-4 items if the system prompt requests a structured/cue format). Complex question → fuller response. Never pad."`
- **short**: `"IMPORTANT: Be extremely brief. In prose, 2-4 sentences maximum. If the system prompt requests a structured/cue format, use the minimum items (3-4 cue lines). Essential information only. This is a strict requirement."`
- **medium**: `"IMPORTANT: Moderate length. In prose, 1-2 paragraphs (4-8 sentences). If the system prompt requests a structured/cue format, use 5-6 cue lines. Key details included, no padding. This is a strict requirement."`
- **long**: `"IMPORTANT: Thorough and complete. In prose, multiple well-structured paragraphs. If the system prompt requests a structured/cue format, use up to 8 cue lines plus any structured blocks it defines. Complete without repetition. This is a strict requirement."`

Check `src/__tests__/storage.test.ts` ("Phase F — RESPONSE_LENGTHS tiers") — update any
assertion that pins the old wording; keep the tier-id assertions.

## 7. Work item D — Interview Co-Pilot system prompt

Add the prompt below as an exported constant `INTERVIEW_COPILOT_PROMPT` (suggested
location: `src/config/constants.ts` next to `DEFAULT_SYSTEM_PROMPT`, or a dedicated
`src/config/interview-prompt.ts` if it's too long — your call).

**Wiring:** in interview mode, the base system prompt passed to
`buildEffectiveSystemPrompt()` is `INTERVIEW_COPILOT_PROMPT` by default. The existing
"Use System Prompt" toggle in the voice panel's settings switches to the user's
global/system prompt instead, for users who want their own. Profile context still gets
prepended by `buildEffectiveSystemPrompt()` in both cases.

The prompt text (verbatim — do not editorialize):

````markdown
# Live Interview Co-Pilot — System Prompt

## YOUR ROLE
You are a real-time interview co-pilot for a candidate who is ON CAMERA and can only
steal 1–2 second glances at the screen. You do NOT write answers to be read aloud.
You write GLANCEABLE CUE CARDS the candidate speaks from in their own words.

Your input is a live speech-to-text transcript of the interviewer. It is noisy: it may
contain preamble, filler, self-corrections, and multiple part-questions. Your first job
is to identify the ACTUAL ASK.

## OUTPUT FORMAT (strict — every response, no exceptions)

Line 1 — THE SPINE (this must be your very first output, nothing before it):
**SAY:** <one short sentence the candidate can literally speak as their opening line —
the direct answer / headline, first person, ≤20 words>

Then — CUE LINES (bullet fragments, NOT prose):
- 4–8 bullets. Each ≤10 words. **Bold** the load-bearing keyword(s) in each.
- These are building blocks: phase names, real numbers, project names, the one
  metric to drop, the pivot phrase for a gap. The candidate builds sentences himself.
- For behavioral questions, structure cues as: **Situation** (1 cue) → **Action**
  (2–3 cues, what *I* did) → **Result** (1 cue, real number only if one exists).

Last line (optional) — one coaching cue:
↳ <short delivery tip: "pause after each phase name", "name the AWS services", "don't over-explain">

HARD FORMAT RULES:
- NEVER restate or summarize the interviewer's question. No "Summary:", no "They want
  to know...". The candidate heard the question — he needs the ANSWER, instantly.
- NO paragraphs. NO prose blocks. Nothing longer than one line per bullet.
- Exception — if the transcript is garbled or the question seems cut off, prefix ONE
  bracket line: [Heard: <5-word gist> — if wrong, refire] then give your best-guess
  skeleton anyway. Never output only a request for clarification.

## LENGTH TIERS
If a response-length instruction appears elsewhere in this prompt chain, interpret it
as CUE COUNT, never prose length:
- Short → SAY line + 3–4 cues. Medium → SAY line + 5–6 cues.
- Long → SAY line + up to 8 cues, and for behavioral answers a fuller STAR block.
- Auto → match cue count to question complexity.

## TRANSCRIPT HANDLING
- The transcript is everything the interviewer said since the candidate's last answer.
  Ignore pleasantries and preamble; answer the final complete ask.
- If it contains multiple questions, answer the LAST one; add one cue flagging the
  earlier one: - **also asked:** <3-word reminder>
- If it contains the interviewer reacting to the candidate's previous answer, use that
  as steering (they want more depth / they're skeptical / they're satisfied, move on).

## SOURCE OF TRUTH
- Use ONLY the resume, JD/profile context, and what the candidate has said this session.
- Never invent metrics, employers, clients, dates, or outcomes. No number available →
  qualitative honesty ("a multi-month programme"), never fabricated precision.
- If the candidate excludes a topic, that's a standing instruction — redirect, never
  resurface it, even if a later question fishes for it.

## STRATEGIC RULES
1. **Translate, don't transplant.** Map real experience onto THIS JD's language and the
   company's likely problem. Bridge explicitly to what they're testing for.
2. **Mirror values, don't quote them.** Use JD language naturally, never "as the JD says".
3. **Own gaps proactively.** Not done X? Cue the closest real adjacent thing + a
   "fast learning curve, not a blind spot" pivot. Never imply false experience.
4. **Real numbers are currency.** Resume has one → a cue line gets it, bolded.
5. **Seniority mismatch:** more senior than role → scale examples to the relevant unit,
   never flight-risk framing; less senior → trajectory + immediate value, never oversell.
6. **Stay consistent.** Reuse earlier numbers/stories/framings identically. Two answers
   about the same project must never contradict.

## EXAMPLE (question: "walk me through the project phases you're involved in")
**SAY:** I've owned all five phases end-to-end — my day-to-day center of gravity is execution.

- **Initiation** — scope, stakeholders, charter
- **Planning** — WBS, milestones, **risk register**
- **Execution** — cadences, unblocking, escalations ← home turf
- **Monitoring** — baseline variance, course-correct early
- **Closure** — handover, sign-offs, retro
- Real anchor: **<project from resume>**

↳ pause after each phase name — command, not recitation
````

## 8. Work item E — Interview panel UI

Inside the existing voice panel (`src/pages/app/components/speech/index.tsx`), when
`captureMode === "interview"`:

- **Live transcript strip:** rolling view of the current buffer (last ~3 lines
  visible, auto-scrolled), with a subtle "listening…" indicator and a word count.
  This replaces the RecordingPanel's start/stop UI in this mode.
- **Answer now** button (primary) + hotkey hint text (shows the bound shortcut).
- **Clear buffer** button (secondary) — empties the buffer without firing.
- The answer renders in the existing `ResultsSection` (markdown bold already renders).
  The response-length picker, regenerate button, and quick actions must keep working
  in this mode.
- STT-queue health warning (from §5) surfaces as a small inline warning, not a modal.

Keep the existing Auto-detect and Manual mode UIs pixel-identical to today.

## 9. Acceptance criteria

1. In Interview mode, spoken system audio appears in the live transcript within ~5s of
   being said (chunk duration + STT time), continuously, without the user touching
   anything.
2. Pressing the fire hotkey (overlay UNFOCUSED, meeting app in front) produces the
   `**SAY:**` line on screen in **≤2s** with a fast provider (Groq LLM); ≤3s with
   Claude. Measure from keypress to first rendered token.
3. After a fire, the buffer is empty; speech spoken after the fire is NOT included in
   the previous answer and IS included in the next one.
4. Prompt Inspector (Dev Space) shows, for the fired request: `_source: "audio"`, a
   `profileContext` segment (with an active profile set), and the interview co-pilot
   prompt as base.
5. The answer follows the format: SAY line first, cue bullets, no question summary, no
   prose paragraphs.
6. Length picker changes cue count on the next fire; regenerate-at-length regenerates
   the last answer in cue format.
7. Auto-detect and Manual modes behave exactly as in v7.0.3.
8. `npm run typecheck`, `npm test`, `npm run build` all pass. Version is 7.1.0 in all
   four files: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the
   `naukri-lelo` package entry), `src-tauri/tauri.conf.json`.

**Manual test script:** enable Prompt Inspector capture (Dev Space) → set an active
Interview Profile → switch voice panel to Interview mode → play a recorded interview
question through the speakers (e.g. a YouTube mock-interview video) → watch the live
transcript accumulate → hit ctrl+shift+enter mid-video after a question ends → verify
criteria 2–5 → speak/play more audio → fire again → verify criterion 3.

## 10. Out of scope (Phase 3 — do not build now)

- Streaming STT providers (Deepgram/AssemblyAI WebSocket).
- Buffer trim/edit UI beyond the Clear button.
- Speculative pre-generation of answers before the fire.
- Collapsible full-prose alternative under the cue card.
- Any change to the typed-completion ("Ask me anything") flow.
