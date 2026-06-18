# Implementation Plan: "Send Profile Once + Brief" + Prompt Caching

**Repo:** Life2death/naukri-lelo-v2 (React + Tauri, SQLite via `tauri-plugin-sql`)
**Goal:** Make interview answers faster by (a) injecting a small AI-generated *brief* of the active interview profile on every turn instead of the full resume/JD/docs, and (b) prompt-caching the large *full-context* prefix for Claude providers when full context is used.
**Author of plan:** prior session (Claude). **You** are the implementing agent. A reviewer will check your diff afterward.

---

## 0. Read this first — architecture facts you must not break

The app supports many AI providers via **curl templates** (`src/config/ai-providers.constants.ts`). It does **not** use the Anthropic SDK. Requests are assembled in `src/lib/functions/ai-response.function.ts` (`fetchAIResponse`) and `buildEnhancedSystemPrompt`.

- The **overlay** completion UI uses `src/hooks/useCompletion.ts` (NOT `useChatCompletion.ts`, which is the chats view).
- `useCompletion.buildEffectiveSystemPrompt()` (around line 97) prepends `profileContextRef.current` (the full profile context) to the system prompt **on every turn**.
- `profileContextRef`/`activeProfileRef` are populated in the `activeProfileId` effect (around line 108) via `buildProfileKnowledgeContext(profile, refTexts)` in `src/lib/functions/profile-context.ts`.
- `fetchAIResponse` → `buildEnhancedSystemPrompt(systemPrompt)` concatenates: `[effective system prompt] + response-length prompt + language prompt + MARKDOWN_FORMATTING_INSTRUCTIONS`, joined by spaces, then substitutes it into the template variable `{{SYSTEM_PROMPT}}` via `deepVariableReplacer`.
- The system string is **not** part of the `messages`/history array — it is re-sent in full every turn. History is also re-sent every turn.
- Context size budget today: up to ~8000 chars (~2000 tokens) per turn (`src/lib/storage/profile-context.storage.ts`, `DEFAULT_PROFILE_CONTEXT_SETTINGS`).

**Provider/model usage:** Production = Claude API. **Testing = whatever free model is configured** (e.g. an OpenRouter free model via a custom provider). Therefore:
- **Brief generation MUST reuse the existing `fetchAIResponse` + currently-selected provider** — do NOT add the Anthropic SDK or hardcode a model. This way testing uses the free model and production uses Claude automatically.
- **Prompt caching is Claude-specific** and only fires for prefixes ≥ ~4096 tokens (Opus 4.8) / ~2048 (Sonnet 4.6). A ~300-token brief will NOT cache. So caching is wired only for the **full-context mode**, and only on Claude provider templates.

**DB migrations** live in `src-tauri/src/db/migrations/*.sql`, registered in `src-tauri/src/db/main.rs` (`migrations()`), highest version currently **5** (`interview-profiles-v3.sql`). Migrations are forward-only `ALTER TABLE`.

Run `npm install` then `npx tsc --noEmit` and `npm test` before declaring done.

---

## Phase 1 — Store a brief on the profile

### 1.1 Migration (version 6)
- New file `src-tauri/src/db/migrations/interview-profiles-v4.sql`:
  ```sql
  -- Migration 6: Add brief_text to interview_profiles
  ALTER TABLE interview_profiles ADD COLUMN brief_text TEXT NOT NULL DEFAULT '';
  ```
  ⚠️ Use **LF** line endings (repo convention for `.sql`).
- Register in `src-tauri/src/db/main.rs` `migrations()` as:
  ```rust
  Migration {
      version: 6,
      description: "add_brief_text_to_profiles",
      sql: include_str!("migrations/interview-profiles-v4.sql"),
      kind: MigrationKind::Up,
  },
  ```

### 1.2 Type + DB action
- `src/types/interview-profile.ts`: add `briefText: string;` to `InterviewProfile`.
- `src/lib/database/interview-profiles.action.ts`:
  - `DbInterviewProfile` interface + row mapper (around line 4 / 26): map `brief_text` → `briefText` (default `""`).
  - INSERT (line ~56): add `brief_text` column + bind `profile.briefText || ""`.
  - UPDATE (line ~66): add `brief_text = ?` + bind `profile.briefText || ""`.
  - If there is a separate `updateProfile`/partial-update helper, thread `briefText` through it too. **Check `useProfiles.ts` and `src/__tests__/interview-profiles.action.test.ts`** and update fixtures/expectations so existing tests still pass.

---

## Phase 2 — Auto-generate the brief at profile save

### 2.1 Brief builder helper
Add to `src/lib/functions/profile-context.ts` (or a new `profile-brief.ts` — match existing import style):

```ts
/** Generates a compact (<= ~300 token) candidate brief from a profile using the
 *  currently-selected AI provider. Returns "" on any failure (caller keeps old brief). */
export async function generateProfileBrief(args: {
  profile: InterviewProfile;
  provider: TYPE_PROVIDER;            // the resolved provider object
  selectedProvider: { provider: string; variables: Record<string, string> };
}): Promise<string> { ... }
```

Implementation notes:
- Build a raw-text prompt from `profile.goals` (target role/JD), `profile.resumeText`, and `profile.documents` (truncate inputs generously, e.g. resume to ~6000 chars, before sending — this is a one-off call so it can be larger than per-turn).
- Prompt instruction (system or user message — use `userMessage`, leave `systemPrompt` minimal):
  > "Compress the following candidate material into a concise interview brief of at most ~250 words / ~300 tokens. Output plain text only, no preamble. Include: top skills, 3–4 signature projects or quantified results, and the candidate's fit for the target role. Do not invent facts."
- Call the **existing** `fetchAIResponse({ provider, selectedProvider, systemPrompt: undefined, history: [], userMessage: prompt })` and **collect all yielded chunks** into one string (it's an async iterable; works for both streaming and non-streaming providers). Trim and return.
- Wrap in try/catch; on error return `""` and `console.warn`. Never throw into the save flow.

⚠️ Do **not** import the Anthropic SDK. Do **not** reference a specific model id. The provider is whatever the user selected (free model in test, Claude in prod).

### 2.2 Generate on save
In `src/pages/profiles/ProfileFormDialog.tsx` (the `onSave` path, `isSaving` flag already exists around line 279):
- After the profile row is created/updated, if resume/goals/documents changed **or** `brief_text` is empty, call `generateProfileBrief(...)` and persist the returned brief via the profile update action (set `briefText`).
- Resolve `provider`/`selectedProvider` from `useApp()` (`selectedAIProvider`, `allAiProviders`) the same way `useCompletion`/`useChatCompletion` do. If no provider is configured, skip brief generation (leave `briefText` as-is) — do not block save.
- Show the existing saving state during generation (it's one network call). Keep save resilient: a brief failure must still save the profile.

> Decision already made by the product owner: **auto-generate at save** (not lazy, not manual). Keep it that way.

---

## Phase 3 — Inject brief per turn (default), full context behind a flag

In `src/hooks/useCompletion.ts`:

### 3.1 Refs
- Keep `profileContextRef` (full context — used for full-context mode + caching).
- Add `profileBriefRef = useRef<string>("")`.
- In the `activeProfileId` effect (~line 108), after loading the profile:
  - `profileContextRef.current = buildProfileKnowledgeContext(profile, refTexts)` (unchanged).
  - `profileBriefRef.current = buildProfileBriefContext(profile)` — a NEW small wrapper that frames just `profile.briefText` with the same `## Active Interview Profile: <name>` header but **only the brief** (no raw resume/docs/refs). If `briefText` is empty, fall back to the full context so behavior never regresses.

### 3.2 buildEffectiveSystemPrompt
Change signature to `buildEffectiveSystemPrompt(useFullContext = false)`:
- `const profileCtx = useFullContext ? profileContextRef.current : (profileBriefRef.current || profileContextRef.current);`
- Rest of the concatenation logic unchanged (`base ? \`${profileCtx}\n\n---\n\n${base}\` : profileCtx`).
- In `submit`, call `buildEffectiveSystemPrompt(fullContextMode)` where `fullContextMode` is a new piece of state/setting (default `false`). For now expose it as a simple boolean from a settings toggle (see Phase 5.3) — if you don't wire UI yet, default `false` and leave a `// TODO: wire full-context toggle` so the reviewer sees the seam.

**Net effect:** default turns send the small brief; full-context mode sends the entire resume/JD/docs (and that path is what caching optimizes).

---

## Phase 4 — Trim other per-turn bloat (free latency, no AI)

1. **Cap history.** In `submit`, before passing to `fetchAIResponse`, slice `messageHistory` to the last N messages (default 6 — i.e. `messageHistory.slice(-6)`). Add a named constant. Do this in `useCompletion.ts` (and consider `useChatCompletion.ts` if the chats view is also used live — but the overlay is the priority).
2. **Lower reference-conversation defaults** in `src/lib/storage/profile-context.storage.ts` `DEFAULT_PROFILE_CONTEXT_SETTINGS`: reduce `maxRefConvs` (3 → 1) and `maxRefConvChars` (1500 → 800). These only affect the full-context path now, but they keep it from ballooning. (Don't touch resume/doc caps — full-context mode wants those.)

---

## Phase 5 — Prompt caching for Claude (full-context mode only)

**Why limited:** caching needs a stable prefix ≥ ~4096 tokens (Opus 4.8). The brief is too small to cache; only the full resume/JD/docs prefix qualifies. So caching is wired to the **full-context** path and only for Claude templates. Prompt caching is **GA — no beta header needed**.

### 5.1 Split the system string into stable + volatile
Today `buildEnhancedSystemPrompt` returns one string. For caching, the **stable** part (profile full context — identical across a session) must be a separate cacheable block from the **volatile** part (length/language/markdown/base prompt + anything per-turn).

- Refactor so `fetchAIResponse` can receive (or compute) two pieces: `systemPromptCached` (the profile full context) and `systemPromptDynamic` (the rest). Keep a single-string fallback for non-Claude providers (substitute the concatenation into `{{SYSTEM_PROMPT}}` exactly as today — no behavior change).

### 5.2 Anthropic template → block-form `system` with cache_control
In `src/config/ai-providers.constants.ts`, the Anthropic provider (the one with `"system": "{{SYSTEM_PROMPT}}"`, around line 36) becomes:
```json
"system": [
  {"type": "text", "text": "{{SYSTEM_PROMPT_CACHED}}", "cache_control": {"type": "ephemeral"}},
  {"type": "text", "text": "{{SYSTEM_PROMPT}}"}
]
```
- Add the new variable `SYSTEM_PROMPT_CACHED` to the substitution map in `fetchAIResponse` (alongside `SYSTEM_PROMPT`).
- ⚠️ **Check `deepVariableReplacer` in `src/lib/functions/common.function.ts`**: confirm replacing `{{SYSTEM_PROMPT}}` does NOT also clobber `{{SYSTEM_PROMPT_CACHED}}` via substring matching. If it does substring replacement, replace `SYSTEM_PROMPT_CACHED` **first**, or make replacement match the full `{{NAME}}` token with word boundaries. Add a unit test for this.
- Only Claude/Anthropic templates use the block form. Leave all other provider templates as plain `{{SYSTEM_PROMPT}}` string (most APIs don't accept an array system field).
- When NOT in full-context mode (brief path), set `SYSTEM_PROMPT_CACHED` to `""` (or collapse to the single-block path) so you don't pay cache-write churn on a tiny/empty prefix.

### 5.3 Full-context toggle (UI)
Add a setting (reuse `src/pages/settings/components/ProfileContextLimits.tsx` area or add a small toggle) "Send full profile context (slower, higher quality)" defaulting OFF. Persist via existing settings storage. Wire it to `fullContextMode` in `useCompletion`.

### 5.4 Verify caching actually works
Claude responses return `usage.cache_creation_input_tokens` / `cache_read_input_tokens`. The curl-template path may discard usage today. At minimum, manually verify with a Claude key that the second turn in full-context mode reports a non-zero `cache_read_input_tokens` (log it behind a debug flag). If `deepVariableReplacer` or trimming introduces any per-turn byte change inside the cached block, the cache silently misses — the cached block must be **byte-identical** across turns (no timestamps, no per-turn data in it).

---

## Sequencing & PRs
- **PR A (Phases 1–4):** the brief pipeline + trims. This is the dominant, low-risk speed win and is provider-agnostic. Ship and measure first.
- **PR B (Phase 5):** Claude caching for full-context mode. More invasive (template + substitution refactor); do after A is verified.

## Definition of done
- `npx tsc --noEmit` clean; `npm test` green (update fixtures for the new column/field).
- New profile save generates and stores a brief using the selected provider (verify with the free test model).
- Overlay interview turns send the brief by default (inspect the outgoing request body / network).
- Full-context toggle sends the full context; with a Claude key, turn 2 shows `cache_read_input_tokens > 0`.
- Existing behavior unchanged when `briefText` is empty (falls back to full context).

## Watch-outs (the reviewer will check these)
- No Anthropic SDK import; brief uses the existing provider abstraction.
- Brief generation never blocks or breaks profile save.
- `{{SYSTEM_PROMPT_CACHED}}` vs `{{SYSTEM_PROMPT}}` substitution order (substring clobber).
- Non-Claude templates untouched (still plain-string system).
- Cached block is byte-stable across turns (else cache never reads).
- `.sql` migration uses LF endings; migration version is 6 and registered.
