# Prompt Capture + Latency Plan

**Goal:** (1) Capture exactly what the app feeds the AI when an interview starts, surfaced in a Dev Space inspector for analysis; (2) make answers *feel fast* (lower time‑to‑first‑token and total answer time), with Anthropic as the primary brain and **prompt caching** as the headline win; (3) keep the app working if **Anthropic is down** via cross‑provider failover.

**Workflow note:** This is a review-and-plan document. A separate coding agent implements; this is the spec. Optimize for **latency** (per decision), Anthropic primary, other providers as fallback.

---

## 0. Background — the injection chain (where the prompt is assembled)

Both the overlay (`useCompletion`) and chat (`useChatCompletion`) funnel into one chokepoint: `fetchAIResponse()` in [src/lib/functions/ai-response.function.ts](src/lib/functions/ai-response.function.ts).

The system prompt is built in two layers:

1. **`buildEffectiveSystemPrompt()`** ([src/hooks/useCompletion.ts:101](src/hooks/useCompletion.ts)) — prepends **profile context** to the base system prompt. Either the compact **brief** (`buildProfileBriefContext`, ~300 tok, current default; `FULL_CONTEXT_MODE = false`) or the **full knowledge dump** (`buildProfileKnowledgeContext`: resume + JD/goals + docs + reference convos, capped by `maxContextChars`, often thousands of tokens) — from [src/lib/functions/profile-context.ts](src/lib/functions/profile-context.ts).
2. **`buildEnhancedSystemPrompt()`** ([src/lib/functions/ai-response.function.ts:14](src/lib/functions/ai-response.function.ts)) — appends, on **every request**:
   - response-length rule — `RESPONSE_LENGTHS` (default `"auto"`, ~110 tok) — [src/lib/response-settings.constants.ts](src/lib/response-settings.constants.ts)
   - language rule — `LANGUAGES` (english, ~5 tok)
   - `MARKDOWN_FORMATTING_INSTRUCTIONS` (~130 tok) — [src/config/constants.ts:43](src/config/constants.ts)

That blob is substituted into `{{SYSTEM_PROMPT}}` in the selected provider's curl template via `deepVariableReplacer` ([:142](src/lib/functions/ai-response.function.ts)). The Claude template ([src/config/ai-providers.constants.ts:28](src/config/ai-providers.constants.ts)) currently sends it as a **plain string**:

```jsonc
"system": "{{SYSTEM_PROMPT}}",
...
"max_tokens": 1024
```

Overlay history is capped to the last 6 messages.

---

## Part A — Capture + Dev Space inspector

### A1. Capture store — `src/lib/debug/prompt-capture.ts` (new)
- In-memory ring buffer (last ~20 requests). Entry: `{ id, timestamp, source: "overlay"|"chat"|"audio", providerId, model, segments, enhancedSystemPrompt, messages, tokenEstimate, usage? }`.
- `recordPromptCapture(entry)`, `getPromptCaptures()`, `subscribe(cb)` (tiny emitter for live UI).
- Persist the **latest** entry to `localStorage` (key e.g. `prompt_capture_last`) so the overlay webview's capture is readable in the Dev Space dashboard webview — reuse the existing cross-window `storage` event pattern already used in `useCompletion`.
- Gate behind a `DEBUG_CAPTURE` flag (localStorage) — **off by default**, zero overhead in normal use.

### A2. Instrument the chokepoint — `fetchAIResponse` ([:142](src/lib/functions/ai-response.function.ts))
- After `bodyObj`/`headers`/`url` are assembled, call `recordPromptCapture(...)` when `DEBUG_CAPTURE` is on.
- **Redact** `Authorization`, `x-api-key`, and any `*key*`/`*token*` header before storing. Never store the raw key.
- For the **segment breakdown**, change `buildEnhancedSystemPrompt` to return `{ text, segments }` (segments: base / profileContext / lengthRule / language / markdown) and thread `segments` into the capture — they aren't separable downstream once joined.
- Capture `usage` from the response when present (see A4).

### A3. Token estimate — `src/lib/debug/token-estimate.ts` (new)
- Cheap `chars/4` heuristic for **relative** comparison. Label it an estimate in the UI (the only exact source is the provider's `usage`).

### A4. Capture real `usage` (enables cache-hit verification)
- In the streaming reader, parse the provider's usage when available. For Anthropic streaming, `message_start` carries `usage` with `cache_read_input_tokens` / `cache_creation_input_tokens` / `input_tokens`; `message_delta` carries `output_tokens`. Store on the capture entry.
- This is what proves Part B caching is actually working.

### A5. Inspector UI — `src/pages/dev/components/prompt-inspector/index.tsx` (new)
- Mount in [src/pages/dev/index.tsx](src/pages/dev/index.tsx) below `JobDiscoveryConfig`.
- Toggle for `DEBUG_CAPTURE`. List of recent captures (collapsible).
- For the selected capture: per-segment char + token estimate + total; message-history size; image-payload size; and (when present) the real `usage` incl. **cache read/write tokens**. Copy-to-clipboard for the full assembled prompt.
- This directly serves "analyze and reduce" — you see what dominates and watch it shrink as Part B/C/D land.

---

## Part B — Anthropic-side optimizations (primary brain)

The app talks to `api.anthropic.com/v1/messages` over **raw HTTP** via the curl template — so these are request-shape changes, not an SDK migration.

### B1. Prompt caching (the headline latency win) — **Claude curl template**
Change the Claude provider's `system` from a string to a cache-marked block array ([src/config/ai-providers.constants.ts:28](src/config/ai-providers.constants.ts)):

```jsonc
"system": [
  { "type": "text", "text": "{{SYSTEM_PROMPT}}", "cache_control": { "type": "ephemeral" } }
],
```

- `{{SYSTEM_PROMPT}}` is still substituted by `deepVariableReplacer` (it replaces inside the string field) — no core code change required for the basic case.
- **No beta header needed** — prompt caching is GA on the first-party Messages API. `anthropic-version: 2023-06-01` stays.
- First turn writes the cache (~1.25× input cost on the cached span); subsequent turns within the 5‑min TTL read it at ~0.1× and with **lower TTFT**. Interview Q&A is bursty (rapid questions) → cache stays warm → big perceived speedup on turns 2+.
- **Critical interplay with brief vs full context:** the minimum cacheable prefix is **4096 tokens on Opus 4.8 / 4.5**, **2048 on Sonnet 4.6 / Haiku 3.5**. The ~300‑token **brief is below the floor and will not cache.** So **for Anthropic-with-caching, use FULL context mode** (`buildEffectiveSystemPrompt(true)`) — the large stable resume/JD/docs prefix is exactly what caching pays off on. This *reverses* the brief-mode default specifically for the Anthropic path. Wire `FULL_CONTEXT_MODE` from a setting (it's currently a hardcoded `false` with a `TODO` at [useCompletion.ts:262](src/hooks/useCompletion.ts) and [:670](src/hooks/useCompletion.ts)); default it **true when the active provider is `claude`**.
- **Byte-stability is mandatory** — any change in the cached prefix invalidates it. `buildEnhancedSystemPrompt` is deterministic today (no timestamps/UUIDs) — keep it that way. The profile context must be stable across turns in a session (it is — built once per `activeProfileId`). Do **not** interpolate per-request values into the system prompt.
- **Verify** via A4: `cache_read_input_tokens > 0` on turns 2+. If it stays 0, a silent invalidator crept into the prefix.

### B2. Raise `max_tokens` realistically + keep streaming
- The Claude template caps `max_tokens: 1024`. Short interview answers fit, but it can truncate longer ones. Keep streaming (already on) and set `max_tokens` to a sane interview value (e.g. 1024–2048 for "short" mode). Output length is the dominant latency factor — see Part D1.

### B3. (Optional) Fast mode — premium, research preview
- Anthropic Fast mode runs Opus 4.8/4.7 at up to ~2.5× output tokens/sec — a real "feels fast" lever — but it's **premium-priced**, a research preview, **first-party only**, and needs the beta endpoint. Over raw HTTP: add header `anthropic-beta: fast-mode-2026-02-01` and `"speed": "fast"` in the body (Opus 4.8/4.7 only). On a 429 it has its own rate-limit pool — fall back to standard (note: switching speed invalidates the cache). **Recommend leaving this off by default**; expose as an opt-in toggle only if cost is acceptable.

### B4. Model choice
- For raw speed, `claude-haiku-4-5` is fastest/cheapest; `claude-sonnet-4-6` balances; `claude-opus-4-8` is most capable. Interview answers are short and latency-sensitive → Haiku or Sonnet are strong "feels fast" picks. This is a user setting (`{{MODEL}}`), not a code change — surface guidance in the inline brain selector. Note Haiku's cache floor is 4096 tok (same as Opus), Sonnet's is 2048.

---

## Part C — Failover: keep working if Anthropic is down

**Key distinction:** Anthropic's own `fallbacks` parameter only covers **safety refusals**, not outages — the docs are explicit that "rate limits, overloads, and server errors are returned as-is, never falling back." So **"Anthropic is down" must be handled at the app layer** by switching to another configured provider. The app already has the pieces: `allAiProviders`, `selectedAIProvider`, and per-provider keys.

### C1. Fallback chain setting
- New setting: an ordered list of provider IDs (e.g. `["claude", "openrouter", "groq"]`). Surface in Dev Space / settings. Default: primary = current selection, then any other configured providers that have valid keys.

### C2. Failover wrapper around `fetchAIResponse`
- Wrap (or extend) the streaming call so that on a **retryable** failure it transparently advances to the next provider in the chain and restarts the stream:
  - **Retryable:** network error / `AbortError` not user-initiated, HTTP `5xx`, `529 overloaded`, `429` after backoff, and request timeout.
  - **Non-retryable:** `400`/`401`/`403` (bad config or key) — surface to the user rather than masking, but still allow advancing to the next provider if the user opted into "always fall over". Make this an explicit setting.
- **Only fail over before the first token is yielded.** Once tokens have streamed, do not silently switch mid-answer — cancel and surface, or restart cleanly. (Mid-stream provider swaps produce incoherent answers.)
- Add a small per-attempt timeout (e.g. 8–12s to first byte) so a hung Anthropic endpoint trips the fallback quickly instead of hanging the overlay. `tauri-plugin-http` fetch accepts an `AbortSignal` — already plumbed via `signal`.
- Emit a subtle UI signal ("answered by <provider>") so the user knows a fallback served the answer. Surface the same in the inspector (A1 already records `providerId`).

### C3. Caching note for fallback
- Prompt caches are per-model and per-provider; a fallback provider starts cold. That's fine — failover is for availability, not speed. Don't try to share cache across providers.

---

## Part D — Latency reductions (provider-neutral, "feels fast")

Ordered by impact. Each should be a setting so you can A/B against the inspector.

1. **Interview mode → "short" output default.** Output token count is the #1 latency driver. Default the overlay to `short` (already exists in `RESPONSE_LENGTHS`) while chat can stay `auto`. Wire a per-surface default in `getResponseSettings`.
2. **Prompt caching** (Part B1) — the other half of "feels fast": cuts TTFT on turns 2+.
3. **Trim / make opt-in `MARKDOWN_FORMATTING_INSTRUCTIONS`** (~130 tok/call). Interview answers rarely need mermaid/LaTeX. Shorten to a one-liner or gate behind a setting. [src/config/constants.ts:43](src/config/constants.ts).
4. **Drop the language line when english** (default) — removes a redundant segment. [ai-response.function.ts:29](src/lib/functions/ai-response.function.ts).
5. **Fast model for interview mode** (Part B4) — Haiku/Sonnet.

**Honest framing:** D3/D4 (input trimming) mainly cut cost and shave a little TTFT. What makes an answer *feel* fast is **D1 (short output) + B1 (caching)** — treat those as the headline; the rest is supporting.

---

## Sequencing

1. **Part A** (capture + inspector) first — it's the measurement tool for everything else.
2. **D1** (short output) — quick, high-impact, verifiable in the inspector.
3. **B1** (caching) + full-context-for-claude — verify `cache_read_input_tokens > 0` in the inspector.
4. **C** (failover) — resilience.
5. **D3/D4** (input trimming), then optional **B3/B4**.

## Verification
- Inspector shows the per-segment breakdown shrinking after D3/D4.
- Real `usage` shows `cache_read_input_tokens > 0` on turns 2+ after B1 (and 0 → non-zero proves the prefix is byte-stable).
- Kill network to `api.anthropic.com` (or use a bad key) → answer still arrives from the next provider in the chain (C), with the "answered by <provider>" signal.
- TTFT and total answer time visibly drop with D1 + B1.

## Risks / caveats
- **Cache floor vs brief:** caching only helps with the *large* stable prefix; the 300‑token brief won't cache. Use full-context mode on the Anthropic path (B1).
- **Byte-stability:** any per-request value in the system prefix silently kills caching. Audit `buildEnhancedSystemPrompt` and profile-context builders for non-determinism.
- **Mid-stream failover** must be avoided — only fall over before the first token.
- **Fast mode** is premium + research preview — keep off by default.
- This app is curl/raw-HTTP based; all Anthropic features here are request-body/header changes within the template, **not** an SDK migration. Keep the provider path provider-neutral; the only Anthropic-specific edit is the `claude` curl template (B1) and, optionally, fast-mode headers (B3).

---

## Handoff to coding agent

### Files this touches
| Concern | File |
|---|---|
| Chokepoint to instrument; `buildEnhancedSystemPrompt` → return `{text, segments}`; parse usage | [src/lib/functions/ai-response.function.ts](src/lib/functions/ai-response.function.ts) |
| Capture store (new) | `src/lib/debug/prompt-capture.ts` |
| Token estimate (new) | `src/lib/debug/token-estimate.ts` |
| Inspector UI (new) | `src/pages/dev/components/prompt-inspector/index.tsx` |
| Mount inspector | [src/pages/dev/index.tsx](src/pages/dev/index.tsx) |
| Claude prompt-caching curl + (opt) fast-mode header | [src/config/ai-providers.constants.ts](src/config/ai-providers.constants.ts) |
| `FULL_CONTEXT_MODE` wiring (2 call sites) | [src/hooks/useCompletion.ts](src/hooks/useCompletion.ts) |
| Short-output default per surface | [src/lib/response-settings.constants.ts](src/lib/response-settings.constants.ts), `getResponseSettings` |
| Markdown rules trim / language line | [src/config/constants.ts](src/config/constants.ts), `ai-response.function.ts` |
| Failover wrapper + chain setting | new wrapper around `fetchAIResponse`; settings + provider storage |

### Build order (do in this sequence, commit a stable checkpoint after each)
1. Part A — capture store + inspector + usage parsing (the measurement tool)
2. D1 — short-output default for the overlay
3. B1 — Claude caching curl + full-context-mode on the claude path; verify `cache_read_input_tokens > 0`
4. Part C — cross-provider failover
5. D3/D4 — input trimming; (optional) B3/B4

### Clarifications (answered 2026-06-27)
- **`segments` shape:** `{ name: string; text: string }[]`. profileContext + base are already merged before `buildEnhancedSystemPrompt`, so split them in `buildEffectiveSystemPrompt` (returns `[{name:"profileContext"},{name:"base"}]`); `buildEnhancedSystemPrompt` appends `[{name:"lengthRule"},{name:"language"},{name:"markdown"}]`; concatenate the two lists at the capture site. The returned `text` MUST stay byte-identical to today's `prompts.join(" ")` — compute it exactly as now; `segments` are **display-only** metadata. Do NOT rebuild `text` by re-joining segments (separators differ: layer 1 `\n\n---\n\n`, layer 2 `" "` — a rebuild corrupts the prompt and breaks caching).
- **Failover:** standalone wrapper `fetchAIResponseWithFailover(...)` in new file `src/lib/functions/ai-response-failover.ts`; it loops the chain calling `fetchAIResponse` per provider. `fetchAIResponse`'s only change is capture instrumentation. Wrapper advances only on **retryable failure before the first token**; once any chunk yields, errors propagate (no mid-stream switch).
- **D1 per-surface default:** `getResponseSettings(source?: "overlay" | "chat")` — overlay→`short`, chat→`auto`, but **only as the default when unset**. An explicit stored `responseLength` always wins.

### Hard constraints
- **Do not migrate the provider path to the Anthropic SDK.** It's a generic curl/raw-HTTP BYOK system — keep it provider-neutral. The only Anthropic-specific edit is the `claude` curl template.
- `DEBUG_CAPTURE` defaults **off**; capture must be zero-overhead when off.
- **Redact** `Authorization` / `x-api-key` / any `*key*`/`*token*` header before storing any capture.
- Keep the system prefix **byte-stable** (no timestamps/UUIDs) or caching breaks.
- **Never fail over mid-stream** — only before the first token.
- Run `npm run typecheck` and `npm run test` before each checkpoint; both must pass.

---

## Testing & acceptance (per phase) — REQUIRED, do not skip

For every phase: add/extend unit tests in `src/__tests__/` (there is already `ai-response.function.test.ts`, `curl-validator.test.ts`, `storage.test.ts`), run `npm run typecheck && npm run test` (green), then do the listed manual check, then commit.

### Part A — capture + inspector
- **Unit:** `buildEnhancedSystemPrompt` returns `{ text, segments }` and `text` is **byte-identical** to the previous string output for the same inputs — add a test asserting equality against a known fixture. Segment `name`s present and ordered.
- **Unit:** redaction — given headers containing `Authorization` / `x-api-key` / `*token*`, the recorded capture has them removed/masked. Assert no raw key string appears anywhere in the serialized capture.
- **Unit:** capture is a no-op when `DEBUG_CAPTURE` is off (spy that `recordPromptCapture` is not invoked / store stays empty).
- **Manual:** enable `DEBUG_CAPTURE`, ask one overlay question, open Dev Space → inspector shows the capture with per-segment sizes; "copy" yields the full prompt; **no API key visible** anywhere. Confirm the overlay-captured entry shows up in the dashboard webview (cross-window via `localStorage` + `storage` event).

### D1 — short-output default
- **Unit:** `getResponseSettings("overlay")` returns `short` when unset; `getResponseSettings("chat")` returns `auto` when unset; a **stored** value overrides both.
- **Manual:** fresh profile, overlay answer is visibly shorter/faster; changing the setting explicitly still takes effect.

### B1 — Anthropic caching (highest-risk phase)
- **Unit (curl integrity):** after editing the `claude` template to the block-array `system`, assert that `curl2Json(provider.curl)` parses without error **and** that after `deepVariableReplacer` substitutes `{{SYSTEM_PROMPT}}`, `bodyObj.system` is `[{ type:"text", text:<prompt>, cache_control:{type:"ephemeral"} }]` (valid JSON, prompt substituted, no stray escaping). Extend `curl-validator.test.ts`.
- **Unit:** other providers (openrouter/openai/groq/…) are **unchanged** — their `system` stays a plain string. Add a guard test so the agent doesn't accidentally touch them.
- **Unit:** `FULL_CONTEXT_MODE` defaults to **true only when the active provider is `claude`**, false otherwise; explicit setting overrides.
- **Manual (the real proof):** with a profile that has a real resume/JD (so the prefix exceeds the cache floor — 4096 tok Opus/Haiku, 2048 Sonnet), ask **two** overlay questions within 5 min. Inspector shows turn 1 `cache_creation_input_tokens > 0`, turn 2 `cache_read_input_tokens > 0`. If turn 2 read is 0 → a silent invalidator is in the prefix; stop and fix before proceeding.
- **Byte-stability check:** capture turn 1 and turn 2 system prompts from the inspector and diff them — the cached prefix portion must be identical.

### Part C — failover
- **Unit:** wrapper advances to the next provider on a simulated retryable failure (network error / 5xx / 529 / timeout) **before** the first token; on a 400/401 it surfaces (or advances only if the "always fall over" setting is on — test both).
- **Unit:** once a chunk has been yielded, a subsequent error **propagates** and does **not** switch providers (no mid-stream swap).
- **Manual:** point the `claude` key to a bad value (or block `api.anthropic.com` via hosts/devtools) → the answer still arrives from the next provider, and the UI/inspector shows "answered by <provider>".

### D3 / D4 — input trimming
- **Unit:** markdown segment is omitted (or one-liner) per the setting; language segment omitted when english. `text` still byte-stable for a given config.
- **Manual:** inspector shows the markdown/language segments shrink to zero; answers still render correctly.

---

## Common slips — explicit guardrails (the agent has dropped these before)

1. **Don't change the return type of a function without updating ALL callers.** `grep` for every caller of `buildEnhancedSystemPrompt` and `buildEffectiveSystemPrompt` and `getResponseSettings` before editing; fix each call site in the same commit. Typecheck catches most — run it.
2. **Don't rebuild the system `text` from segments.** Separators differ; the authoritative `text` is computed exactly as today. Segments are display-only.
3. **Don't break the curl template's JSON.** The `claude` curl is a template string with escaped quotes and `\\` line-continuations. After your edit, the body must still be valid JSON *after* variable substitution. The unit test in B1 is mandatory — do not eyeball it.
4. **Don't touch non-Anthropic providers** in B1. Only the `claude` entry gets `cache_control`.
5. **Don't leave `DEBUG_CAPTURE` on by default**, and don't let capture run when off. No measurable overhead in the normal path.
6. **Don't log or store API keys.** Redact before the object is stored; assert it in a test.
7. **Don't fail over mid-stream.** Track "has any chunk yielded"; after the first token, errors propagate.
8. **Don't migrate to the Anthropic SDK.** Raw-HTTP/curl only; provider-neutral core.
9. **Don't add scope not in this file** (no new settings pages, refactors, deps, or "while I'm here" cleanups). If something seems needed but isn't written here, ask first.
10. **Don't commit red.** Every checkpoint: `npm run typecheck` AND `npm run test` pass. If a pre-existing test is already failing on `main`, note it in the commit message rather than "fixing" unrelated code.
11. **Don't assume the overlay and dashboard share memory** — they're separate webviews. The inspector reads captures via `localStorage` + the `storage` event, not a shared module singleton.

---

## Pre-commit checklist (run at EVERY checkpoint)
- [ ] `npm run typecheck` → clean
- [ ] `npm run test` → green (note any pre-existing failures, don't silently fix unrelated code)
- [ ] New/changed behavior has a unit test
- [ ] No API key or auth header in any captured/stored/logged object
- [ ] Diff is scoped to this phase only — no unrelated edits
- [ ] Commit message: what phase + what changed + test status

## Round-2 review findings (2026-06-27) — fix these before sign-off

Reviewed against the committed code on `main`. **What's correct:** B1 curl block-array + `cache_control` (non-Anthropic providers untouched), byte-stable `text` via `join(" ")`, `FULL_CONTEXT_MODE` auto-true for `claude` only, mid-stream failover guard (`hasYielded`), per-surface default with explicit-value-wins, markdown trim. Typecheck clean, 150 tests pass. The items below must still be fixed.

### BLOCKER 1 — Failover sends the PRIMARY's API key/model to the fallback provider (defeats the whole "Anthropic down" goal)
`fetchAIResponseWithFailover` reuses `selectedProvider.variables` for **every** provider in the chain ([ai-response-failover.ts:92-95](src/lib/functions/ai-response-failover.ts)). When it falls over from `claude` to e.g. `openrouter`, it substitutes Claude's `API_KEY` and `MODEL` into OpenRouter's request → 401 / invalid model → the fallback always fails. So the app does **not** keep working when Anthropic is down — the core Part C requirement is unmet.
**Fix:** each chain entry must carry its **own** variables. Per-provider variables already exist in `useApp().providerVariables` (`Record<providerId, Record<string,string>>`, [app.context.tsx](src/contexts/app.context.tsx)).
- Change `FailoverParams.failoverChain` to `{ provider: TYPE_PROVIDER; variables: Record<string,string> }[]`.
- In the wrapper, build `attemptParams.selectedProvider = { provider: entry.provider.id, variables: entry.variables }` (use the entry's variables, not the outer `selectedProvider`).
- In all call sites (useCompletion ×2, useChatCompletion, useSystemAudio), build the chain as `[{ provider, variables: providerVariables[provider.id] || {} }, ...fallbacks.map(p => ({ provider: p, variables: providerVariables[p.id] || {} }))]`.
- **Test:** assert the fallback attempt is invoked with the fallback provider's variables, not the primary's. The current `failover.test.ts` passes without covering this — that's why it slipped.

### BLOCKER 2 — D4 "skip language when english" is a no-op (wrong constant)
[ai-response.function.ts:46](src/lib/functions/ai-response.function.ts) and [:59](src/lib/functions/ai-response.function.ts) guard with `responseSettings.language !== "en"`, but the english id is `"english"` (`DEFAULT_LANGUAGE`, [response-settings.constants.ts:219](src/lib/response-settings.constants.ts)) — so the condition is always true and the english language line is never skipped. The D4 optimization does nothing.
**Fix:** compare against `"english"` (import `DEFAULT_LANGUAGE` and use it) in **both** the text-building check and the segments check, keeping them identical so `text` stays byte-stable. **Test:** with language=english the `markdown` segment is present and `language` segment is absent.

### SHOULD-FIX 3 — Cache-hit usage doesn't reach the inspector cross-window (B1 can't be verified end-to-end)
Usage is parsed correctly ([ai-response.function.ts:327-344](src/lib/functions/ai-response.function.ts)) and written onto the in-memory ring entry ([:360-368](src/lib/functions/ai-response.function.ts)), but the `localStorage` copy (`PROMPT_CAPTURE_LAST`) was written at record time **without** usage and is never updated. The overlay makes the request; the Dev Space **inspector is a separate webview** that reads via `localStorage`, so it never sees `cache_read_input_tokens`. That's the exact number needed to prove caching works.
**Fix:** after setting `latest.usage`, re-write `localStorage[PROMPT_CAPTURE_LAST]` with the updated entry (and notify listeners). Verify the inspector shows turn-2 `cache_read_input_tokens > 0` for an overlay question.

### MINOR / cleanup
- `redactHeaders` and `instrumentCaptureParams` in [prompt-capture.ts](src/lib/debug/prompt-capture.ts) are **dead code** — headers are never stored and `fetchAIResponse` calls `recordPromptCapture` directly. Either remove them, or actually store redacted headers per plan A2. (No key leak today — keys live in headers, which aren't stored.)
- Capture stores full base64 **image** data inside `messages`; a screenshot capture can blow the `localStorage` quota (write silently fails in the `catch`). Strip/elide image `data` fields before storing.
- Confirm `_source: "audio"` is wired in `useSystemAudio` and that the audio surface's default length is intended (currently `auto`; interview audio answers may want `short` — see open question).

### Open question for the user
- Should the **audio** (system-audio interview answers) surface also default to `short` like the overlay? Plan only specified overlay→short, chat→auto. Currently audio falls through to `auto`.

## Phase E — Responses config = single source of truth + overlay runtime control (supersedes D1's per-surface default)

**Intent:** the sidebar **Responses** page is the single source of truth for response settings; the overlay shows the current choice and lets the user change it at runtime (mid-interview) without opening settings. This **replaces** D1's per-surface hardcoded default (overlay→short) — there is now one config value used everywhere, and the user controls it.

### E0. What already exists (reuse, don't reinvent)
- Settings page [src/pages/responses/index.tsx](src/pages/responses/index.tsx) → `ResponseLength`, `LanguageSelector`, `AutoScrollToggle`.
- Single store: `RESPONSE_SETTINGS` localStorage via `getResponseSettings()` / `updateResponseLength()` / `updateLanguage()` / `updateAutoScroll()` ([src/lib/storage/response-settings.storage.ts](src/lib/storage/response-settings.storage.ts)).
- The length prompt is read **fresh at submit time** inside `buildEnhancedSystemPrompt` ([ai-response.function.ts:28](src/lib/functions/ai-response.function.ts)) — so a runtime change automatically applies to the **next** question with no extra wiring.
- Overlay response panel + `ProfileContextBanner` live in [src/pages/app/components/completion/Input.tsx](src/pages/app/components/completion/Input.tsx) (header block ~lines 97–155; banner at ~159).

### E1. Revert the per-surface default (single source of truth)
- Simplify `getResponseSettings()` back to **one** config read — remove the `source` param branching and `getDefaultForSource` added in D1 ([response-settings.storage.ts](src/lib/storage/response-settings.storage.ts)).
- Update callers that pass a `source` for length purposes (`buildEnhancedSystemPrompt`, the `getResponseSettings("overlay")` autoscroll call in useCompletion) to call `getResponseSettings()`. Keep capture's `_source` attribution separate — it does not affect length.
- Set the **global default** (`DEFAULT_RESPONSE_LENGTH`) per the decision below.

### E2. Overlay runtime control — new component
- New `src/pages/app/components/completion/ResponseQuickSettings.tsx`: a compact **Popover/Dropdown** mirroring the Responses page options — at minimum **Response Length** (Short / Medium / Auto segmented), plus Language and Auto-scroll if desired (see decision).
- Reads current values via `getResponseSettings()`; writes via the existing `updateResponseLength()` / `updateLanguage()` / `updateAutoScroll()`. **No new storage key, no ephemeral state** — it edits the same config the Responses page does.
- **Placement:** a small always-visible trigger on the overlay **input row** (right side of the input in `Input.tsx`) showing the current length (e.g. `Short ▾`) so it's changeable *before* asking; also reflect the current selection in the response-panel header. (The response panel only opens after a question, so the input-row trigger is the primary surface.)

### E3. Cross-window sync (the part most likely to be done wrong)
The overlay and the Responses page are **separate webviews** sharing the same `localStorage` origin.
- On change, the writing window must update its **own** UI immediately (the `storage` event does **not** fire in the window that made the write).
- Other windows must update via a `window` `storage` listener on the `RESPONSE_SETTINGS` key (same pattern already used for conversation/provider sync).
- Add a tiny custom event too (e.g. `dispatchEvent(new Event("response-settings-changed"))`) so any same-window listeners (the Responses page components) refresh without a full reload.
- Acceptance: change length on the overlay → the Responses page reflects it (and vice-versa) without restart; the next question uses the new length.

### E4. Tests
- `getResponseSettings()` returns the single stored config (no per-surface branching); default = the chosen global default when unset.
- The overlay control writes through `updateResponseLength()` and the value is what `buildEnhancedSystemPrompt` picks up on the next call.
- A stored explicit value is reflected identically on both the Responses page and the overlay control.

### Decisions (answered 2026-06-27)
1. **Global default length = `short`.** Set `DEFAULT_RESPONSE_LENGTH = "short"` ([response-settings.constants.ts:218](src/lib/response-settings.constants.ts)) so unset installs are fast-by-default. (This is the single global default, applied everywhere — overlay, chat, audio — since per-surface defaulting is removed in E1.)
2. **Overlay control = Response Length only** (Short / Medium / Auto). Language and Auto-scroll stay on the Responses page only. Build `ResponseQuickSettings` with just the length switch.

## Definition of done (whole feature)
- [ ] Inspector shows per-segment breakdown + real `usage` (incl. cache tokens) for overlay, chat, and audio paths
- [ ] Overlay defaults to short output; explicit setting still wins
- [ ] Anthropic caching verified live: turn-2 `cache_read_input_tokens > 0` with a real profile
- [ ] App keeps answering when `api.anthropic.com` is unreachable (failover proven manually)
- [ ] Markdown/language segments trimmable via setting; verified in inspector
- [ ] `DEBUG_CAPTURE` off by default; zero overhead when off; no key leakage
- [ ] `main` compiles and all tests green at the final checkpoint
