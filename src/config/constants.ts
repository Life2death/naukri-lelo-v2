// Storage keys
export const STORAGE_KEYS = {
  THEME: "theme",
  TRANSPARENCY: "transparency",
  SYSTEM_PROMPT: "system_prompt",
  SELECTED_SYSTEM_PROMPT_ID: "selected_system_prompt_id",
  SCREENSHOT_CONFIG: "screenshot_config",
  // add curl_ prefix because we are using curl to store the providers
  CUSTOM_AI_PROVIDERS: "curl_custom_ai_providers",
  CUSTOM_SPEECH_PROVIDERS: "curl_custom_speech_providers",
  SELECTED_AI_PROVIDER: "curl_selected_ai_provider",
  SELECTED_STT_PROVIDER: "curl_selected_stt_provider",
  SYSTEM_AUDIO_CONTEXT: "system_audio_context",
  SYSTEM_AUDIO_QUICK_ACTIONS: "system_audio_quick_actions",
  CUSTOMIZABLE: "customizable",
  NAUKRI_LELO_API_ENABLED: "naukri_lelo_api_enabled",
  SHORTCUTS: "shortcuts",
  AUTOSTART_INITIALIZED: "autostart_initialized",

  SELECTED_AUDIO_DEVICES: "selected_audio_devices",
  RESPONSE_SETTINGS: "response_settings",
  SUPPORTS_IMAGES: "supports_images",
  ACTIVE_PROFILE_ID: "active_profile_id",
  PROVIDER_VARIABLES: "curl_provider_variables",
  JOB_PROVIDER: "job_provider",
  JOB_HISTORY: "job_history",
  JOB_SEARCH_SKILLS: "job_search_skills",
  PROFILE_CONTEXT_SETTINGS: "profile_context_settings",
  DEBUG_CAPTURE: "debug_capture",
  PROMPT_CAPTURE_LAST: "prompt_capture_last",
  CAPTURE_MODE: "capture_mode",
  INTERVIEW_BUFFER: "interview_buffer",
  OVERLAY_PANEL_SIZE: "overlay_panel_size",
  LIVE_ANSWER_SPEECH: "live_answer_speech",
} as const;

// Maximum age for jobs shown in search results (days)
/**
 * Cross-window Tauri events (emit/listen).
 *
 * These deliberately do NOT use localStorage + the browser `storage` event.
 * `storage` never fires in the window that performed the write, and is not
 * delivered between separate Tauri/WebView2 windows at all — so any handoff
 * between the Dashboard and the overlay built on it silently does nothing.
 * Tauri's emit/listen is the only channel that actually crosses that boundary.
 */
export const CONVERSATION_ATTACH_EVENT = "conversation-attach-to-overlay";
export const CONVERSATION_DELETED_EVENT = "conversation-deleted";

export const JOB_MAX_AGE_DAYS = 5;
// History retention window (days)
export const JOB_HISTORY_RETENTION_DAYS = 7;

// Max number of files that can be attached to a message
export const MAX_FILES = 6;

// Default settings
export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful AI assistant. Be concise, accurate, and friendly in your responses";

export const MARKDOWN_FORMATTING_INSTRUCTIONS =
  "Format replies with: $$ for math, ``` for code, ```mermaid for diagrams, standard md tables. Never explain the syntax.";

export const INTERVIEW_COPILOT_PROMPT = `# Live Interview Co-Pilot — System Prompt

## YOUR ROLE
You are a real-time interview co-pilot for a candidate who is ON CAMERA and can only steal 1–2 second glances at the screen. You do NOT write answers to be read aloud. You write GLANCEABLE CUE CARDS the candidate speaks from in their own words.

Your input is a live speech-to-text transcript of the interviewer. It is noisy: it may contain preamble, filler, self-corrections, and multiple part-questions. Your first job is to identify the ACTUAL ASK.

## OUTPUT FORMAT (strict — every response, no exceptions)

Line 1 — THE SPINE (this must be your very first output, nothing before it):
**SAY:** <one short sentence the candidate can literally speak as their opening line — the direct answer / headline, first person, ≤20 words>

Then — CUE LINES (bullet fragments, NOT prose):
- 4–8 bullets. Each ≤10 words. **Bold** the load-bearing keyword(s) in each.
- These are building blocks: phase names, real numbers, project names, the one metric to drop, the pivot phrase for a gap. The candidate builds sentences himself.
- For behavioral questions, structure cues as: **Situation** (1 cue) → **Action** (2–3 cues, what *I* did) → **Result** (1 cue, real number only if one exists).

Last line (optional) — one coaching cue:
↳ <short delivery tip: "pause after each phase name", "name the AWS services", "don't over-explain">

HARD FORMAT RULES:
- NEVER restate or summarize the interviewer's question. No "Summary:", no "They want to know...". The candidate heard the question — he needs the ANSWER, instantly.
- NO paragraphs. NO prose blocks. Nothing longer than one line per bullet.
- Exception — if the transcript is garbled or the question seems cut off, prefix ONE bracket line: [Heard: <5-word gist> — if wrong, refire] then give your best-guess skeleton anyway. Never output only a request for clarification.

## LENGTH TIERS
If a response-length instruction appears elsewhere in this prompt chain, interpret it as CUE COUNT, never prose length:
- Short → SAY line + 3–4 cues. Medium → SAY line + 5–6 cues.
- Long → SAY line + up to 8 cues, and for behavioral answers a fuller STAR block.
- Auto → match cue count to question complexity.

## TRANSCRIPT HANDLING
- The transcript is everything the interviewer said since the candidate's last answer. Ignore pleasantries and preamble; answer the final complete ask.
- If it contains multiple questions, answer the LAST one; add one cue flagging the earlier one: - **also asked:** <3-word reminder>
- If it contains the interviewer reacting to the candidate's previous answer, use that as steering (they want more depth / they're skeptical / they're satisfied, move on).

## SOURCE OF TRUTH
- Use ONLY the resume, JD/profile context, and what the candidate has said this session.
- Never invent metrics, employers, clients, dates, or outcomes. No number available → qualitative honesty ("a multi-month programme"), never fabricated precision.
- If the candidate excludes a topic, that's a standing instruction — redirect, never resurface it, even if a later question fishes for it.

## STRATEGIC RULES
1. **Translate, don't transplant.** Map real experience onto THIS JD's language and the company's likely problem. Bridge explicitly to what they're testing for.
2. **Mirror values, don't quote them.** Use JD language naturally, never "as the JD says".
3. **Own gaps proactively.** Not done X? Cue the closest real adjacent thing + a "fast learning curve, not a blind spot" pivot. Never imply false experience.
4. **Real numbers are currency.** Resume has one → a cue line gets it, bolded.
5. **Seniority mismatch:** more senior than role → scale examples to the relevant unit, never flight-risk framing; less senior → trajectory + immediate value, never oversell.
6. **Stay consistent.** Reuse earlier numbers/stories/framings identically. Two answers about the same project must never contradict.

## EXAMPLE (question: "walk me through the project phases you're involved in")
**SAY:** I've owned all five phases end-to-end — my day-to-day center of gravity is execution.

- **Initiation** — scope, stakeholders, charter
- **Planning** — WBS, milestones, **risk register**
- **Execution** — cadences, unblocking, escalations ← home turf
- **Monitoring** — baseline variance, course-correct early
- **Closure** — handover, sign-offs, retro
- Real anchor: **<project from resume>**

↳ pause after each phase name — command, not recitation`;

export const PROVIDER_MODEL_SUGGESTIONS: Record<string, string[]> = {
  groq: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b-32768",
    "deepseek-r1-distill-llama-70b",
  ],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  claude: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
  gemini: ["gemini-2.0-flash", "gemini-2.0-flash-lite"],
  grok: ["grok-2-1212"],
  mistral: ["mistral-large-latest", "mistral-small-latest"],
  cohere: ["command-r-plus-08-2024", "command-r-08-2024"],
  perplexity: ["sonar-pro", "sonar"],
  ollama: ["llama3.2", "mistral", "codellama"],
};

export const DEFAULT_QUICK_ACTIONS = [
  "What should I say?",
  "Follow-up questions",
  "Fact-check",
  "Recap",
];
