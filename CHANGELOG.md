# Focus Assistant — Changelog & Application Notes

> A free, open-source productivity assistant. Built on **Tauri 2** (Rust
> backend) + **React 19 + TypeScript + Vite 7** (frontend) with **Shadcn UI
> + Tailwind 4** styling. Local-first — your resume and API keys never
> leave your machine.
>
> _Previously branded **Naukri Lelo** through v2.1.2. The application binary,
> Windows installer, Task Manager entry, and visible UI are all
> "Focus Assistant" from v2.1.3 onward. The GitHub repository remains
> `naukri-lelo-v2` for continuity of issue history and release URLs._

---

## What this app does today

| Page              | Purpose                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard         | Configure the free OpenRouter / Groq API keys + see **Recent Job Activity** across all profiles                                    |
| Chats             | Browse past interview-prep conversations                                                                                           |
| Interview Profiles| Create/edit profiles (resume + goals). Each card has **Start Prep** and **Find Jobs** buttons                                       |
| Find Jobs         | Per-profile job search via Tavily or Serper, AI-scored against your resume, with skill chip editor + history                       |
| System Prompts    | Manage prompt library for the AI                                                                                                   |
| Dev Space         | API key configuration for: AI providers (LLMs), STT providers (speech), and **Job Discovery** (Tavily + Serper with active toggle) |
| Settings          | Theme, transparency, autostart                                                                                                     |
| Responses         | Configure response length & language                                                                                               |
| Screenshot        | Stealth screen-capture for invisible interview help                                                                                |
| Audio             | System audio devices & transcription settings                                                                                      |
| Shortcuts         | Global keyboard shortcuts + cursor settings                                                                                        |

### How the Find Jobs flow works

1. Open **Interview Profiles** → click **Find Jobs** on any profile card.
2. The Jobs page (`/profiles/:id/jobs`):
   - Loads the profile from SQLite via `getProfileById()`
   - Pre-fills the keywords box from the first line of the profile's goals
   - **AI-extracts** the top 12 skills from the resume + goals using your
     configured LLM provider (`extractSkillsWithAI()`). Falls back to regex
     keyword matching when AI is unavailable.
   - Loads any **user-edited skill overrides** from `localStorage["job_search_skills"]`
3. Click **Search** → calls `searchJobs()` which routes to Tavily or Serper
   depending on the active provider in `localStorage["job_provider"]`.
4. Results are **filtered**:
   - Non-job URLs rejected by `isJobUrl()` (LinkedIn member profiles, company
     landing pages, recruiter portals)
   - Older than 5 days rejected by `filterJobsByAge()` (parses ISO + relative
     strings like *"2 days ago"*, *"yesterday"*)
5. Each surviving result is:
   - **AI-scored 0–100** vs the resume via `scoreJobWithAI()` (top 10 only, to
     avoid rate limits)
   - **Recorded in history** via `recordJobView()` (deduped by `url+profileId`,
     auto-pruned past 7 days, capped at 500 entries)
6. Clicking **Apply** opens the listing via Tauri's secure `openUrl()` and
   marks the entry with `clickedAt` so it shows ✓✓ in the History section
   (WhatsApp-style double-tick).

### Storage keys used (`localStorage`)

| Key                          | Shape                                                                |
| ---------------------------- | -------------------------------------------------------------------- |
| `job_provider`               | `{ activeProvider, tavilyKey, serperKey }`                           |
| `job_history`                | `JobHistoryEntry[]` (max 500, 7-day TTL)                             |
| `job_search_skills`          | `{ [profileId]: string[] }`                                          |
| `theme`                      | `"light" \| "dark" \| "system"` (default: `"light"`)                 |
| `teleprompter_enabled`       | `"true" \| "false"` — gates the footer toggle                        |
| `teleprompter_font_size`     | `string` (10–36, default 13)                                         |
| `teleprompter_opacity`       | `string` (0.35–1.0, default 0.92)                                    |
| Other (existing)             | `screenshot_config`, `system_audio_*`, `curl_*`, `active_profile_id` |

### Source code map

```
src/
├── pages/
│   ├── dashboard/          # NaukriLeloApiSetup + RecentJobs card
│   ├── profiles/           # Profile list + Start Prep / Find Jobs buttons
│   ├── jobs/               # Find Jobs page + JobHistorySection
│   └── dev/components/job-discovery/  # API-key config UI with green-active indicator
├── lib/
│   ├── functions/
│   │   └── job-search.function.ts   # Tavily/Serper search, AI extractors, age + URL filters
│   ├── storage/
│   │   ├── job-providers.ts        # CRUD for API keys + active provider
│   │   ├── job-history.ts          # View/click ledger with auto-prune + day grouping
│   │   └── job-search-skills.ts    # Per-profile edited-skill overrides
│   └── database/                   # SQLite-backed InterviewProfile CRUD
├── types/
│   ├── job.ts              # JobListing, JobProviderConfig
│   └── job-history.ts      # JobHistoryEntry
├── config/constants.ts     # STORAGE_KEYS + JOB_MAX_AGE_DAYS / JOB_HISTORY_RETENTION_DAYS
└── global.css              # Light blue & white theme (v2.1.2)
```

---

## Release history

### Unreleased

- 🐛 **Fix: Interview mode answers could still go missing from Chats.** The
  v9.0.0 fix seeded a `conversation.id` for Auto-detect/Interview so the
  debounced save could run at all, but the save itself still only fired
  500ms after the last change, and nothing flushed it early. Stopping
  capture, restarting it, or closing the app within that window silently
  cancelled the pending save via the save effect's own cleanup — dropping
  the most recent (often the only) fired answer with no error shown.
  `stopCapture`, `startCapture`, and unmount now flush any pending save
  immediately via a new `flushPendingConversationSave`.

### v9.1.0 (July 30 2026)

- 🐛 **Fix: TTS mute deadlock.** Releasing the hold-to-read-answer key
  (`Insert`/`CapsLock`) paused speech but never announced "not speaking," so
  interview/live capture stayed muted at the Rust source with nothing left to
  un-mute it — a self-sustaining lockup requiring a manual stop/restart.
- 🐛 **Fix: aborting a voice answer didn't actually stop it.** `processWithAI`
  built an `AbortController` but never passed its signal to the request, so
  `stopCapture` and unmount aborted a signal nobody was listening to.
- 🐛 **Fix: deleting a conversation the overlay was using could resurrect it.**
  The delete notification and "Open in Overlay" both still relied on the
  browser `storage` event, which — like the Prompt Inspector bug fixed in
  v9.0.0 — is never delivered between separate Tauri windows. Switched to
  Tauri `emit`/`listen`.
- 🐛 **Fix: API errors could be saved to history as the AI's answer.** Request
  failures were `yield`ed as ordinary response text instead of thrown, so a
  401 or network error rendered as the assistant's reply, showed no error UI,
  and was persisted to SQLite — then fed back as context on the next turn.
  Failures now throw a typed `AIResponseError`.
- 🐛 **Fix: voice-mode conversation history sent to the LLM in reverse order.**
  From the third turn onward the model received `[Q3,A3,Q2,A2,Q1,A1]` instead
  of chronological order, so follow-ups resolved against the wrong turn.
- 🐛 **Fix: `$` in a question or resume could corrupt the request body.**
  Unescaped `$` in substituted values let `String.replace`'s special
  replacement patterns (`$&`, `$$`, `` $` ``) mangle the prompt — e.g. asking
  about `$&` sent the model the literal text `{{TEXT}}`.
- 🐛 **Fix: the overlay's screenshot button silently discarded the image.**
  It captured and previewed the screenshot ("will be sent with next
  transcription") but nothing ever attached it to the actual AI request.
- 🐛 **Fix: duplicate Tauri event listeners could transcribe every utterance
  twice.** Several `listen()` calls had no cancellation guard against a
  teardown that ran before the async registration resolved, leaking a second
  live subscription — reliably reproducible via StrictMode's double-invoke.
- 🐛 Also fixed: Auto-detect silently dropping a question asked while the
  previous answer was still streaming (now queued instead of discarded);
  Manual mode permanently hiding the VAD sensitivity settings after first use;
  a reader/connection leak on every AI-provider failover hop; a dropped final
  chunk when a provider's stream ended without a trailing newline; and several
  stale-closure/dependency-array bugs that could send a voice answer to a
  provider, model, or API key that had since been changed.
- ✨ **New: dev builds are tinted green.** Running `npm run tauri dev` now
  renders in a distinct accent color from any built exe (local or from the
  GitHub release workflow), so it's obvious at a glance which window is which
  when both are open at once.
- 🔧 **Fix: the active System Prompt and Interview Profile selection didn't
  survive across a dev build and a production build.** Both are different
  webview origins, so anything kept in `localStorage` — including which
  prompt/profile was selected — silently diverged between them even though
  both builds already shared the same SQLite database. Moved the selection
  into a new shared `app_settings` SQLite table, adopting whatever an
  existing install's `localStorage` already held on first run.
- ✨ **AI Context and length shortcuts now match across Auto-detect and
  Interview mode.** The "Use Interview Co-Pilot" toggle only worked in
  Interview mode, and the response-length quick-settings/regenerate-at-length
  controls were hidden specifically in Interview mode — with no functional
  reason, since both live modes share the same capture pipeline. Both
  controls are now available in both modes.
- 🐛 **Fix: the Co-Pilot prompt ignored the selected response length.** Its
  own output-format section hardcoded "4–8 bullets" as a strict rule, which
  competed with (and reliably won out over) the separate length-tier
  instruction meant to vary that count by the Short/Medium/Long/Auto setting.
  Reworded so the length tier is unambiguously authoritative.
- 🔧 Updated the Claude model suggestions in the Brain selector to the 5th
  generation (`claude-sonnet-5`, `claude-opus-5`, plus `claude-fable-5`
  alongside the unchanged `claude-haiku-4-5`).
- 🔖 Version bumped to 9.1.0 across `package.json`, `tauri.conf.json`,
  `Cargo.toml`, and `Cargo.lock`.

### v9.0.0 (July 24 2026)

- ✨ **New: Hold to Read Answer shortcut.** Press-and-hold `Insert` (`CapsLock`
  on macOS) to play the current AI answer aloud, release to pause in place,
  press again to resume from exactly where you left off. A new answer always
  restarts from the beginning rather than resuming the previous one. Distinct
  from the existing toggle hotkey (`Ctrl+Shift+R`), which is unchanged.
- 🐛 **Fix: TTS silently not speaking.** The `custom-shortcut-triggered` Tauri
  event listener in `useGlobalShortcuts.ts` could get registered twice — a
  race in the "clean up existing listener, then async re-register" pattern
  that isn't atomic against React 19 StrictMode's dev-mode double-invoke of
  effects. Every hotkey press fired its callback twice, and the second
  invocation immediately canceled the speech the first had just started.
  Guarded the whole setup behind a module-level flag set synchronously
  before any `await`, so it only ever runs once per app lifetime.
- 🐛 **Fix: VAD/Interview answers never appeared in Chats.** `startCapture`'s
  Auto-detect/Interview branch never seeded a `conversation.id` — only Manual
  mode did — so the debounced save silently bailed out every time. Now seeds
  a fresh id there too.
- 🐛 **Fix: duplicate concurrent AI answers for closely-spaced utterances.**
  `autoAnswerQuestion`'s re-entrancy guard checked the `isAIProcessing` React
  state, which could still read stale by the time a second utterance's STT
  resolved (the callback ref it's called through only refreshes after a full
  render/commit cycle). Two utterances landing close together could both
  slip past the guard and fire a real, redundant API call. Replaced with a
  synchronous `isAIProcessingRef`.
- 🐛 **Fix: the `[WAIT]` filler-suppression sentinel could still flash on
  screen and pollute history.** Streamed responses were pushed to the answer
  panel chunk-by-chunk as they arrived, so a `[WAIT]` response (used by
  system prompts to signal "nothing to answer here") would still overwrite
  the real previous answer for the second or so it took to stream in, and —
  being non-empty — still got saved as a conversation turn. The stream is
  now buffered until it's provably not `[WAIT]` before touching the display,
  and a confirmed `[WAIT]` result is never committed to history.
- 🐛 **Fix: Prompt Inspector always showed "No captures yet."** Cross-window
  sync relied on a browser `storage` event, already known unreliable across
  separate Tauri/WebView2 windows in this codebase (see the `emit`/`listen`
  workaround already in `theme.context.tsx`). Since all real prompt capture
  happens in the overlay window while the inspector lives in the Dashboard's
  Dev Space, it never received anything. Switched to `emit`/`listen`, with a
  mount-time backfill of the last known capture.
- 🐛 **Fix: newly created System Prompts invisible in the overlay until a
  full restart.** Same root cause as the earlier profiles bug — the
  overlay's prompt list only fetched once on mount, and a prompt created in
  a different window never triggered a refetch. Now refreshes on every
  picker open, mirroring `ProfileSelector`'s existing fix.
- 🔧 **Length-rule precedence clause.** `buildEnhancedSystemPrompt` now
  appends a short clause clarifying that its response-length instruction
  only governs the shape of a real answer and never overrides an earlier
  system-prompt instruction to stay silent or output a placeholder instead.
- 🔖 **Version unified to 9.0.0** across `package.json`, `tauri.conf.json`,
  `Cargo.toml`, and `Cargo.lock`.

### v6.1.0 (June 10 2026)

- ✨ **New: Floating-bar mode & inline brain selectors.**
  `BrainSelector` lets you switch AI provider + model inline in the overlay via
  Popover — no need to dive into Dev Space mid-interview. `SystemPromptSelector`
  lets you choose the system prompt mode from the same floating bar.
- 🔐 **Per-provider key persistence.** API keys and model selections are now
  saved per-provider and restored automatically when you switch back (fixes a
  bug where switching providers previously wiped your key).
- 🧩 **Extracted `useOpenRouterModels` hook.** Free-model fetching from
  OpenRouter's API is now reusable; also used in `Providers.tsx`.
- 📋 **`PROVIDER_MODEL_SUGGESTIONS` config.** Per-provider default model lists
  for Groq, OpenAI, Claude, Gemini, Grok, Mistral, Cohere, Perplexity, and
  Ollama.
- 🔄 **Cross-window sync.** `PROVIDER_VARIABLES` key added to the storage
  event listener so changes propagate across windows.

### v6.0.0 (June 10 2026)

- 🐛 **Fix: app failed to launch on existing installs (startup panic).**
  `tauri-plugin-sql` (sqlx) stores a SHA-384 of each migration's raw bytes and
  re-verifies it on every launch. On Windows, git `autocrlf` checked out
  `src-tauri/src/db/migrations/*.sql` with CRLF, changing the hash versus the LF
  checksum recorded in the existing database → integrity check failed →
  `.expect()` panic at `src-tauri/src/lib.rs:285`. Every build, even older ones,
  crashed against an existing DB.
- 🔧 **Added `.gitattributes` pinning `*.sql` (and the migration files) to
  `eol=lf`** so migration checksums are byte-stable across every OS and checkout.
  Working tree renormalized to LF. Migrations remain immutable — future schema
  changes must be added as a new migration version, never by editing a shipped one.
- 🔖 **Version unified to 6.0.0** across `package.json`, `tauri.conf.json`,
  `Cargo.toml`, and `Cargo.lock` (previously drifted: 5.0.0 in the frontend vs
  2.2.1 in the Rust crate, so the app reported itself as v2.2.1).

### v2.2.1 (May 20 2026)

- 🐛 **Fix: teleprompter showed an empty window when chatting from the
  floating overlay.** v2.1.3 wired `pushTeleprompterText` into
  `useChatCompletion.ts` (the expanded `/chats` page), but the
  floating overlay uses a *different* hook — `useCompletion.ts` — and
  that path never emitted the event. So the teleprompter window opened
  correctly, the event listener registered correctly, but nothing was
  ever sent. Added `clearTeleprompterText()` before each request and
  `pushTeleprompterText(fullResponse)` inside both streaming loops
  (plain text + screenshot/image-attached) in `useCompletion.ts`.
- 🔓 **Restored window-control permissions on the teleprompter capability.**
  v2.2.0 created an isolated `teleprompter.json` capability with only
  `core:default` + `core:event:default`. That was too strict — it broke
  the in-window X button, drag-to-move, and resize-handles that
  v2.1.8 added. Added back the three permissions the UI actually
  needs: `core:window:allow-close`, `allow-start-dragging`,
  `allow-start-resize-dragging`. The window still cannot create
  sub-windows, run shell, access SQL/keychain/HTTP, etc. — the
  security envelope stays tight.

### v2.2.0 (May 20 2026)

- 🔐 **Security hardening release** (commit 8dff2fb, pushed from secondary
  dev machine). Highlights:
  - `secure_storage.json` now encrypted at rest with AES-256-GCM using a
    machine-derived key.
  - API keys back-stored in the OS keychain (Windows Credential Manager,
    macOS Keychain, libsecret on Linux).
  - XSS sanitisation for AI-generated markdown output in
    `src/components/Markdown/index.tsx`.
  - Screen/audio capture IPC restricted to the main window only —
    overlay/teleprompter/sub-windows can no longer trigger capture.
  - New isolated `teleprompter` Tauri capability (windows list scoped
    to `teleprompter` only).
  - Runtime permission validation for capture commands.
  - `reqwest` switched to `rustls-tls` (avoids transitive `openssl` CVEs).
- 🩹 Follow-up fix commits 72f2a5e + 1bcc7eb addressed Rust + TS build
  failures introduced by the rewrites (invalid keychain command names,
  an unused `KEYCHAIN_SERVICE` constant).

### v2.1.9 (May 20 2026)

- 📌 **Profile context banner in the overlay chat.** The floating overlay has
  been combining the active Interview Profile (resume + goals + custom docs
  + reference conversations) with the selected System Prompt for a while —
  `useCompletion.ts → buildEffectiveSystemPrompt() → buildProfileKnowledgeContext()`.
  But nothing in the UI told you it was happening. Added a thin banner at
  the top of the response panel that reads e.g. "Answering as Director
  Delivery · resume + goals + 1 doc + 2 ref convs" so you can verify the
  AI is using the right context before asking a question.
  - Reads `activeProfileId` from `AppContext`; renders nothing when no
    profile is active.
  - Pulls counts: `profile.documents.length` and the on-disk
    `profile_refs_<id>` localStorage array (saved Prep-Session conversations).
- ⚡ **CI: type check now runs before Rust setup.** v2.1.7 burned ~2 min on
  Cargo cache restore + Tauri bootstrap before failing on a trivial TS2578.
  Added `npm run typecheck` (a thin `tsc --noEmit` wrapper) as an explicit
  step in `.github/workflows/release.yml` immediately after `npm ci`. Future
  TypeScript errors will fail the release build in <30 s instead of ~2 min,
  so iteration is faster. Same check now also gates every push.

### v2.1.8 (May 20 2026)

- 🔧 **Build fix for v2.1.7.** TypeScript rejected the two `@ts-expect-error`
  directives I wrote around the `startResizeDragging` fallback because the
  Tauri 2.x type bundle does already expose the method. Refactored the
  fallback to use a proper structural cast and a clean `typeof fn ===
  "function"` runtime check — no suppression directives, no type warnings,
  same runtime behaviour. (v2.1.7 had no installer because of this; install
  v2.1.8 instead.)

### v2.1.7 (May 20 2026)

- 🐛 **Fix: teleprompter window never actually opened.** The WebviewWindow
  URL was `index.html#/teleprompter` (hash routing) but the app uses
  `BrowserRouter`, which ignores the hash. So Tauri created the window,
  loaded `index.html`, and React Router resolved `/` → `<App />` instead
  of `<Teleprompter />` — the window was invisible/empty so it looked
  like nothing happened.
  - Switched to the same pattern the `capture-overlay-*` windows already
    use: URL is plain `index.html`, and `main.tsx` dispatches on the
    window label to render `<Teleprompter />` directly without the
    router/AppProvider tree.
  - Removed the now-redundant `/teleprompter` route from `AppRoutes`.
- 🖱️ **Fix: window can now be resized with the mouse.** The overlay had
  `resizable: true` but `decorations: false`, so the OS drew no grab
  handles. Added eight CSS-positioned hot-zones (4 edges + 4 corners)
  inside the teleprompter; each one calls Tauri's
  `start_resize_dragging` IPC with the appropriate direction on
  `mousedown`. The bottom-right corner also shows a subtle three-line
  visual grip so it's discoverable. The required permission
  `core:window:allow-start-resize-dragging` was added to both
  capability files.
- The overlay is also fully draggable — grab the header bar to move it.

### v2.1.6 (May 19 2026)

- 🩹 **Restored bundle identifier to `com.naukrilelo.app`.** v2.1.3 renamed
  the bundle ID to `com.focusassistant.app` along with the visible rebrand.
  Tauri scopes per-user data (SQLite database + WebView2 localStorage) by
  bundle ID, so upgraders found their interview profiles, system prompts,
  chat history, API keys, and job history appearing "empty" — the data was
  actually intact at the old `%APPDATA%\com.naukrilelo.app\` path; the new
  build was just reading from a fresh `com.focusassistant.app\` folder.
  Reverting the identifier makes the app read from the original location
  again, so all previously-stored data reappears with no manual migration.
- Task Manager display, window title, sidebar header and installer name
  continue to show "Focus Assistant" — only the under-the-hood bundle ID
  string changes. The `naukrilelo` token in the bundle ID is not surfaced
  anywhere visible to a user during normal use (it shows only deep in the
  Windows registry under `Installer/UserData`).

### v2.1.5 (May 19 2026)

- 🧹 **Removed defunct "Naukri Lelo Prompts" section from System Prompts page.**
  This section was a remnant from a decommissioned cloud prompt-library
  service. The remote API was removed back in commit `f236e72` ("Free
  version with license removed"), but the consuming UI was left in place,
  showing a perpetual "Naukri Lelo API Not Enabled" empty state because
  there's no UI to ever flip the flag. Deleted the unused
  `NaukriLeloPrompts.tsx` component; the user's local SQLite-backed system
  prompts (top of the page) are unchanged and continue to work normally.

### v2.1.4 (May 19 2026)

- 🐛 **Fix: Teleprompter toggle now arms the Save Changes button.** The toggle
  was previously auto-saving on click (matching the AlwaysOnTop pattern), which
  was inconsistent with the rest of the Settings page where Theme and
  Transparency live behind a single "Save Changes" button. Refactored
  `TeleprompterToggle` into a controlled component owned by the Settings
  page — clicking the switch now flips a pending state, the Save Changes
  button enables, and the value persists on click. Closing the teleprompter
  window when turning off is moved into the Save handler too.

### v2.1.3 (May 19 2026)

- 🪪 **Rebranded to "Focus Assistant"** — productName, identifier, bundle ID,
  window title, sidebar header, error layout, "Quit X" menu item, Dashboard
  copy, and Contribute/Promote cards all updated. The `.exe` is now
  `Focus Assistant.exe` in Task Manager. The GitHub repo stays
  `naukri-lelo-v2` (issue history continuity); only the installed binary
  carries the new identity.
- 🎨 **New icon** — neutral focus-reticle design (blue gradient circle, thin
  white concentric rings, centred dot). Generated by
  `scripts/generate-icons.py` (Pillow). Replaces all PNG/ICO/ICNS variants
  under `src-tauri/icons/`.
- 📺 **Teleprompter / Reading Mode** — new floating overlay window pinned to
  the top of the primary monitor (just below the webcam) so reading-gaze
  deviation stays minimal during video calls.
  - New `App Settings → Teleprompter` toggle. When on, a small
    "Reading Mode" pill appears anchored to the bottom of the app — click
    to open/close the overlay.
  - Overlay is a separate Tauri webview window (label `teleprompter`),
    transparent, always-on-top, no decorations, drag-region in the header.
  - Live AI answers stream into the overlay via the Tauri event bus
    (`teleprompter:update`) — the main chat stream pushes each accumulated
    response chunk; the overlay subscribes and re-renders. New questions
    clear the prior answer (`teleprompter:clear`).
  - Per-overlay controls: **font-size +/-** (10 – 36 px), **opacity +/-**
    (35 – 100 %), **close**. Font and opacity preferences persist in
    `localStorage`.
  - Capabilities updated: both `default.json` and `cross-platform.json` now
    permit `core:webview:allow-create-webview-window`, position/size
    setters, focus, current-monitor, and the event channel — scoped to the
    `teleprompter` window.

- 🎨 **Light blue + white theme** — replaced the monochrome black/white palette
  with a sky-blue accent. Sidebar gains a soft blue tint, primary buttons,
  rings and active-states use blue 500. Default theme switched from
  `"system"` to `"light"`. Existing dark mode is retained but is now blue-tinted
  rather than pure grey, so the visual identity stays consistent if a user
  toggles it on.
- 🧹 **Filter LinkedIn member profiles** from job results — new `isJobUrl()`
  helper rejects `linkedin.com/in/…`, `/pub/`, `/sales/`, `/school/`,
  `/posts/`, `/feed/`, `/learning/`, `/company/<x>/` (without `/jobs`), plus
  Naukri recruiter pages and Indeed/Glassdoor company-landing pages. Both
  Tavily and Serper paths now run results through the filter so users only
  see real openings.
- 📝 Added this `CHANGELOG.md` as a single source of truth for application
  state. Will be kept in sync on every commit.

### v2.1.1 (May 18 2026)

- 🤖 **AI skill extraction** — `extractSkillsWithAI()` calls the user's
  configured LLM with the resume + goals and asks for the top 12 skills as
  JSON. Falls back to keyword matching on parse failure.
- 💾 **Save skills button** — appears on the Find Jobs page when chips differ
  from the saved snapshot. Stores per-profile in `localStorage["job_search_skills"]`,
  doesn't pollute the underlying interview profile.
- 📅 **5-day freshness filter** — `parseJobAgeDays()` understands ISO dates
  (Tavily) and relative strings *"2 days ago"*, *"yesterday"*, *"just now"*
  (Serper). UI shows "*N hidden (older than 5 days)*" counter.
- 🗂️ **Recent Job Activity** on the Dashboard + history section on Find Jobs.
  Per-profile filter, day-bucketed (Today / Yesterday / N days ago), WhatsApp
  ✓ (seen) / ✓✓ (opened) ticks, auto-deletes after 7 days, max 500 entries.

### v2.1.0 (May 17 2026)

- 💼 **Find Jobs button** on every Interview Profile card (next to Start Prep).
  New route `/profiles/:id/jobs`.
- 🔑 **Dev Space → Job Discovery panel** with side-by-side **Serper.dev** +
  **Tavily** cards. Active provider gets a **green border** + "Active" zap
  badge. Each provider has show/hide key input, **Test** button (live API
  ping), and **Make active** switcher. Keys saved to
  `localStorage["job_provider"]`.
- 🔎 Job search via Tavily (`api.tavily.com/search` with `include_domains`
  filter) or Serper (`google.serper.dev/jobs`). AI-scores each result 0–100
  against the candidate resume.
- 🧠 Skills extraction (regex baseline), skill chip editor, location +
  keywords search box.
- 🛠️ Build pipeline fixed — JS↔Rust Tauri package versions re-aligned, lockfile
  pinned to v2.0.7 baseline, CI tsc check green.

### v2.0.7 (April 28 2026)

- Baseline before job-discovery restoration. Pure interview-prep app with
  AI chat, profile management, system prompts, screenshot, audio, shortcuts.

---

## Job search providers — why mostly Naukri & LinkedIn?

Most results visibly come from **Naukri**, **LinkedIn**, and **Indeed**
because:

1. **Serper.dev wraps Google Jobs**, which already crawls these big boards
   directly and ranks them first. The free tier returns ~20 jobs per query;
   roughly 70 % cluster around LinkedIn / Naukri / Indeed / Glassdoor.
2. **Tavily** is a general web-search API. We restrict it to a curated domain
   list (`linkedin.com`, `naukri.com`, `indeed.com`, `glassdoor.com`,
   `wellfound.com`, `unstop.com`, `internshala.com`, `monster.com`). Smaller
   ATS-hosted boards (Workday, Greenhouse, Lever, SmartRecruiters) are not
   in that list — they could be added but each ATS has thousands of subdomains.
3. **Direct scraping is blocked** by Cloudflare on Indeed/Glassdoor for most
   IPs, by LinkedIn entirely without login, and by Naukri with aggressive bot
   detection. Going through Google Jobs (Serper) is the only practical way
   to surface these.
4. **Niche boards** (Wellfound for startups, Unstop for early-career India,
   AngelList, RemoteOK, WeWorkRemotely) don't have rich structured-data
   markup, so even when they're in Tavily's index, the title/company/location
   parsing is hit-or-miss.

To improve coverage we could (future work):

- Add a Workday/Greenhouse/Lever **direct API** path — these ATS systems
  expose public JSON endpoints per company. Requires a curated company list.
- Plug in **RapidAPI's "JSearch"** or **Adzuna** as a third provider —
  better coverage of mid-tier boards, but neither is fully free.
- Surface a **"Search source"** dropdown in Dev Space letting the user
  bias toward a specific board (e.g. "India-focused → Naukri/Foundit,
  Global → LinkedIn/Indeed").

---

## Build & release

- **CI:** `.github/workflows/ci.yml` — runs `tsc --noEmit` + `vitest run` on
  push.
- **Release:** `.github/workflows/release.yml` — triggered by `v*.*.*` tag
  push. Builds Windows `.exe`/`.msi` via `tauri-action@v0`. Publishes as a
  draft release on GitHub.
- **Versioning:** keep these three in sync — `package.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (and update
  `src-tauri/Cargo.lock` for the `naukri-lelo` package entry).
- **Lockfile rule:** Tauri's JS ↔ Rust minor versions must match. Don't run
  `npm install --force`; use plain `npm ci`. If you must update deps, run
  `cargo update` in `src-tauri/` afterwards.
