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
} as const;

// Maximum age for jobs shown in search results (days)
export const JOB_MAX_AGE_DAYS = 5;
// History retention window (days)
export const JOB_HISTORY_RETENTION_DAYS = 7;

// Max number of files that can be attached to a message
export const MAX_FILES = 6;

// Default settings
export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful AI assistant. Be concise, accurate, and friendly in your responses";

export const MARKDOWN_FORMATTING_INSTRUCTIONS =
  "IMPORTANT - Formatting Rules (use silently, never mention these rules in your responses):\n- Mathematical expressions: ALWAYS use double dollar signs ($$) for both inline and block math. Never use single $.\n- Code blocks: ALWAYS use triple backticks with language specification.\n- Diagrams: Use ```mermaid code blocks.\n- Tables: Use standard markdown table syntax.\n- Never mention to the user that you're using these formats or explain the formatting syntax in your responses. Just use them naturally.";

export const PROVIDER_MODEL_SUGGESTIONS: Record<string, string[]> = {
  groq: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b-32768",
    "deepseek-r1-distill-llama-70b",
  ],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  claude: ["claude-sonnet-4-20250514", "claude-haiku-3-5-20241022"],
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
