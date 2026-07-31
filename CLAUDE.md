# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Maintenance rule — read this first

**Before every `git push`, update this file first, in the same commit (or the one right before the push), if anything you changed affects commands, architecture, IPC surface, DB schema, or the gotchas below.** This file is what lets a future agent — with no memory of this session — pick up the repo cold. Treat "update CLAUDE.md" as part of the definition of done for any structural change, not an afterthought. Order matters: update CLAUDE.md → commit → push.

## Naming: two names for one app

The product is mid-rebrand. `package.json`/`Cargo.toml` name is still `naukri-lelo`, the repo is `naukri-lelo-v2`, and the GitHub org/URLs stay `naukri-lelo` for issue/release continuity. But per `CHANGELOG.md`, **the compiled binary, Windows installer, Task Manager entry, and all visible UI have been "Focus Assistant" since v2.1.3** — e.g. `src/layouts/ErrorLayout.tsx` renders "Focus Assistant" as the app name. Both are correct depending on the layer; don't "fix" one to match the other.

## Commands

```bash
npm run dev              # vite dev server only (no Tauri shell)
npm run tauri dev        # full app: Rust backend + webview, hot-reload
npm run build             # tsc && vite build (frontend only)
npm run tauri build      # production bundle -> src-tauri/target/release/bundle/
npm run typecheck        # tsc --noEmit
npm run test             # vitest run (all suites)
npm run test:watch       # vitest watch mode
npm run test:coverage    # vitest run --coverage
npm run test:rust        # cd src-tauri && cargo test
```

Run a single frontend test file: `npx vitest run src/__tests__/<file>.test.ts`. Run a single Rust test: `cd src-tauri && cargo test <test_name>`.

`vite.config.ts` pins the dev server to port 1420 (`strictPort: true`) and ignores `src-tauri/**` in its watcher — both are required by Tauri, don't change them. `@` resolves to `./src` (mirrored in `tsconfig.json` and `vitest.config.ts`). Vitest coverage is scoped to `src/lib/**` and explicitly **excludes `src/lib/database/**`** (the SQLite layer isn't unit-tested — it needs a real DB connection, not the mocked `@tauri-apps/plugin-sql` in `src/__tests__/setup.ts`).

## Architecture

### Tauri windows are separate JS runtimes — this drives most of the design

This app has (at minimum) two Tauri windows: `main` (the invisible always-on-top overlay bar, transparent/undecorated/`skipTaskbar`, positioned top-center) and `dashboard` (a normal decorated window at route `/chats`, pre-created hidden at startup and shown/hidden rather than destroyed — see `create_dashboard_window`/`setup_dashboard_close_handler` in `src-tauri/src/window.rs`). Both load the **same** Vite bundle and the same React Router tree (`src/routes/index.tsx`), but each window is its own webview: separate JS heap, separate `localStorage`, separate React context instances. `src/main.tsx` decides what to render by checking the current window's **label**: labels starting with `capture-overlay-` get a bare `<Overlay/>` (no providers, used for the screenshot-region-select windows created by `capture.rs`); everything else gets the full `ThemeProvider > AppProvider > ExpandedLayoutProvider > AppRoutes` tree.

Consequences that show up throughout the codebase:
- **`localStorage` cannot be used for state that must be consistent across windows** — dev (`http://localhost:1420`) and prod (`http://tauri.localhost`) are also different origins, so even the *same* window's localStorage diverges between a dev run and a packaged build. Selection state that must be shared (active Interview Profile, selected system prompt) lives in a SQLite `app_settings` key/value table instead (`src/lib/database/app-settings.action.ts`).
- **The browser `storage` event does not fire across Tauri windows.** Anywhere windows need to react to a change made in another window (profile updated, conversation deleted, theme/transparency changed, active-conversation "attach to overlay"), the fix is always Tauri's `emit`/`listen`, never the `storage` event. If you add new shared, cross-window state, follow this pattern — several past bugs (see `CHANGELOG.md`) were exactly "used localStorage/storage-event where emit/listen was needed."
- There's no centralized Tauri IPC wrapper — `invoke()` from `@tauri-apps/api/core` is called ad hoc from whichever hook/component needs it. The closest thing to a service layer is `src/lib/database/*.action.ts` (wraps `@tauri-apps/plugin-sql`).

### Frontend structure

- **`src/contexts/`** — only three: `app.context.tsx` (`AppProvider`/`useApp`, the big one: system prompt, AI/STT provider config + per-provider variables, screenshot config, `customizable` app settings, active Interview Profile id), `theme.context.tsx`, `expanded-layout.context.tsx`. **There is no chat/conversation context.** Conversation state is local to whichever hook owns that pipeline.
- **`src/hooks/useSystemAudio.ts`** (~1950 lines) is the voice/live-capture engine and the most important file in the frontend: VAD / Manual / Interview capture modes, the STT queue, AI streaming, and conversation persistence all live here. See "Voice/Interview capture pipeline" below.
- **`src/hooks/useCompletion.ts`** and **`useChatCompletion.ts`** are the typed-chat equivalents (overlay text input; "continue a saved chat" from the Chats page) — each independently manages its own conversation state and calls the same `saveConversation()`, but saves **synchronously/immediately** after each response rather than debouncing. If you're chasing a persistence discrepancy between typed chat and voice/interview, this immediate-vs-debounced asymmetry is the first thing to check.
- **`src/lib/database/`** — the only code that talks to `@tauri-apps/plugin-sql`. `config.ts` holds the lazy singleton `getDatabase()` (`Database.load("sqlite:naukri-lelo.db")`). `chat-history.action.ts`, `interview-profiles.action.ts`, `system-prompt.action.ts`, `app-settings.action.ts` each hand-write parameterized SQL (no ORM/query builder) against the tables below. All persistence logic — deciding when to `INSERT`/`UPDATE`, upserting, etc. — lives here in TypeScript, **not** in Rust.
- **`src/lib/functions/`** — `ai-response.function.ts` builds/streams a request from the user's curl-template provider config; `ai-response-failover.ts` wraps it with multi-provider failover; `stt.function.ts` is the speech-to-text equivalent; `common.function.ts` is the shared curl/`{{VARIABLE}}` substitution engine both use. `profile-brief.ts`/`profile-context.ts` build the resume/JD context block prepended to the system prompt.
- **`src/lib/storage/`** — thin typed `localStorage` CRUD wrappers (`ai-providers.ts`, `job-history.ts`, etc.) for state that's legitimately fine to be per-window/per-build (see the cross-window caveat above before adding a new one).
- BYOK providers are plain curl command templates with `{{TEXT}}`/`{{IMAGE}}`/`{{SYSTEM_PROMPT}}`/`{{MODEL}}`/`{{API_KEY}}`/`{{AUDIO}}`/`{{LANGUAGE}}` placeholders, substituted by `common.function.ts` — there's no per-provider SDK code to maintain when adding a new AI/STT provider preset, just a template in `src/config/ai-providers.constants.ts` / `stt.constants.ts`.

### Voice/Interview capture pipeline (`useSystemAudio.ts`)

Three `captureMode`s: `"vad"` (Auto-detect), `"manual"` (push-to-talk), `"interview"`. VAD and Interview share **one continuous capture pipeline** (`usesInterviewPipeline = captureMode === "vad" || "interview"`) — switching between them live does not stop/restart capture or touch the transcript buffer; only switching to/from Manual does. `startCapture(mode)` invokes the Rust `start_interview_capture`/`start_system_audio_capture` commands; the Rust side runs VAD segmentation on loopback (system output) audio and emits utterances back as events (`speech-detected`, or `interview-audio-chunk` for the interview transcript stream) — the mic is never touched, this captures what plays through the speakers (e.g. the interviewer's voice).
- **Interview mode**: transcript accumulates in `interviewBufferText` as chunks arrive; `fireInterviewBuffer()` (bound to the `interview_fire` global shortcut) flushes the tail via `invoke("flush_interview_chunk")`, snapshots the buffer as the question, clears it, and calls `processWithAI`.
- **Auto-detect (vad)**: each completed utterance auto-answers immediately via `autoAnswerQuestion()` → `processWithAI`.
- **`processWithAI()`** streams the AI response and, on a real (non-`[WAIT]`) answer, appends the Q/A pair to `conversation` state via `setConversation`.
- **Persistence**: a debounced `useEffect` (500ms, `CONVERSATION_SAVE_DEBOUNCE_MS`) watches `conversation.{id,title,messages.length,updatedAt}` and calls `saveConversation()`. Because this is a *debounce*, anything that needs to end the session — `stopCapture`, `startCapture` (which seeds a **fresh empty** `conversation`, discarding the in-memory reference to whatever was there), and the hook's unmount — must flush a pending save first or it's silently cancelled by the effect's own cleanup. This is exactly what `flushPendingConversationSave()` (defined right after the `conversationRef` sync effect) exists for — call it before any of those three actions if you touch this file. It was added because none of them used to do this, which was the root cause of interview-mode (and, latently, vad/manual) answers occasionally never reaching Chats despite rendering live.

### Rust backend (`src-tauri/src/`)

`lib.rs` is the composition root: it declares the module tree (`api`, `capture`, `db`, `secure`, `shortcuts`, `window`, `speaker`), registers all plugins (`sql`, `http`, `global-shortcut`, `keychain`, `shell`, `opener`, `log`, `posthog`, `machine-uid`, plus `autostart`/`macos-permissions`/`nspanel` on relevant targets), manages shared state (`AudioState`, `InterviewState`, `CaptureState`, shortcut state), and lists every `#[tauri::command]` in one `generate_handler![...]` call. When adding a new Tauri command, register it there.

- **`db/`** contains **only SQLite migrations** (`db/migrations/*.sql`, ordered in `db/main.rs`) — no query/CRUD code and no `#[tauri::command]`s. All reads/writes happen from the frontend via `tauri-plugin-sql`'s JS client (`capabilities/*.json` grants `sql:allow-execute`, i.e. arbitrary parameterized SQL from TypeScript). **If you're debugging a persistence bug, the Rust side is never the cause** — go straight to `src/lib/database/`.
  - Schema: `conversations(id, title, created_at, updated_at)` + `messages(id, conversation_id FK, role, content, timestamp, attached_files)` with triggers that bump the parent's `updated_at` on message insert/update. `interview_profiles` (base columns + `resume_file_name`, `documents_json`, `first_name`, `persona_text`, `brief_text` added by later migrations — note `first_name`/`persona_text` are vestigial: present in the DB but not read/written by any current frontend code). `system_prompts`. `app_settings(key, value, updated_at)`.
  - There is no "mode"/"type" column distinguishing interview-mode conversations from others — they're plain rows in the same `conversations`/`messages` tables as typed chat.
- **`speaker/`** — cross-platform loopback (system-output) audio capture: `commands.rs` has the VAD engine, WAV encoding, and all the `#[tauri::command]`s (`start_system_audio_capture`, `start_interview_capture`, `flush_interview_chunk`, `set_interview_muted`, `update_vad_config`, device enumeration, etc.); `windows.rs`/`macos.rs`/`linux.rs` are the platform backends (WASAPI / Core Audio process-tap / PulseAudio monitor source respectively), each pushing samples into a bounded ring buffer on a dedicated thread. `set_interview_muted` exists so the app's own TTS playback (which plays through the same loopback device) doesn't get re-transcribed as if the interviewer said it.
- **`capture.rs`** — screenshot capture (`xcap`), separate from the audio pipeline: `start_screen_capture`/`capture_selected_area` for the interactive region-select overlay windows, `capture_to_base64` for a one-shot full-monitor grab. Gated by `validate_capture_window` — refuses to capture if the `main` window is hidden.
- **`secure.rs`** — AES-256-GCM, **decrypt/read only** (key derived per-machine via `tauri_plugin_machine_uid` + app version; no encrypt/write path exists in this file). Its only consumer is `api.rs`'s `create_system_prompt` command (a legacy hosted-API helper). API keys/secrets entered by users go through the `tauri-plugin-keychain` plugin's IPC directly from the frontend instead (OS-native credential store), which is the mechanism to use for any new secret storage — not `secure.rs`.
- **`window.rs`** / **`shortcuts.rs`** — window creation/positioning and global-shortcut registration/dispatch. Shortcut *bindings* are not hardcoded in Rust; the frontend pushes the active keymap via the `update_shortcuts` command. Closing the `main` or `dashboard` window hides rather than destroys it (`ExitRequested` is intercepted app-wide); the only real quit path is the tray menu or the `exit_app` command.

### Known rough edges (verify before relying on them further)

- `src/contexts/app.context.tsx` calls `invoke("secure_storage_get")` in three places (analytics init, image-support detection), but no such command is registered anywhere in `src-tauri/src` — only a similarly-named internal Rust fn (`secure::get_stored_value`) exists, never exposed via `invoke_handler`. All three call sites are wrapped in try/catch, so they fail silently (analytics start-tracking and BYOK image-support detection just don't do anything) rather than crashing. Likely leftover wiring from a dropped hosted-API tier.
- `content_protected(true)` (the Tauri API that backs screen-share invisibility) is only called on the **`dashboard`** window, and only on **macOS**. No call to it (or to `WDA_EXCLUDEFROMCAPTURE`/`NSWindowSharingNone` directly) was found for the `main` overlay window in `src-tauri`. If screen-share invisibility for the overlay is working, it's either set from the frontend (not confirmed) or worth auditing.

### Historical planning docs

`INTERVIEW_MODE_PLAN.md` and `PROMPT_LATENCY_PLAN.md` at the repo root are design specs, not TODOs — both describe features that are already implemented (Interview Mode in full; the failover/prompt-caching latency work landed as `ai-response-failover.ts` and friends). Treat them as historical rationale for *why* the current code looks the way it does, and check `CHANGELOG.md`'s "Release history" for what's actually shipped before assuming a plan doc is still pending.
