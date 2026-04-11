# Naukri Lelo

<div align="center">

<img src="/images/banner.svg" alt="Naukri Lelo — Free AI Interview Assistant" width="100%" />

<br/>

[![Open Source](https://img.shields.io/badge/Open%20Source-GPL%20v3-green?style=for-the-badge)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-orange?style=for-the-badge&logo=tauri)](https://tauri.app/)
[![React](https://img.shields.io/badge/Frontend-React%20%2B%20TypeScript-blue?style=for-the-badge&logo=react)](https://reactjs.org/)
[![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D4?style=for-the-badge&logo=windows)](https://github.com/Life2death/naukri-lelo/releases)
[![Free Forever](https://img.shields.io/badge/Price-Free%20Forever-brightgreen?style=for-the-badge)](https://github.com/Life2death/naukri-lelo)

> **नौकरी लेलो** — *Get the job.*
>
> A free, open-source AI interview assistant that stays **completely invisible during screen sharing**.
> No license. No subscription. No paywall. Ever.

</div>

---

## What is Naukri Lelo?

Naukri Lelo is a desktop app that sits as a transparent overlay on your screen during interviews, coding tests, and meetings — helping you with real-time AI answers, live transcription, and screenshot analysis — while remaining **completely invisible** to anyone watching your screen share on Zoom, Google Meet, Microsoft Teams, or any other platform.

It is fully free and open-source under GPL v3. All features are unlocked for everyone.

---

## How Invisibility Works

On **Windows** the app uses `WDA_EXCLUDEFROMCAPTURE` via `SetWindowDisplayAffinity` — a native Windows API that removes the window from the DWM compositor pipeline before any screen capture tool can see it. No workaround exists from the capturing side.

On **macOS** it uses `NSWindowSharingNone` which tells the OS not to include the window in any screen share or recording stream.

In Tauri this is configured via `contentProtected: true` in `tauri.conf.json`.

---

## Features

| Feature | Description |
|---|---|
| **Invisible Overlay** | Window excluded from all screen captures, recordings, and screen shares |
| **Real-time Transcription** | Capture system audio or microphone, transcribe live via your STT provider |
| **AI Answers** | Stream responses from any LLM — OpenAI, Claude, Gemini, Groq, Ollama, or custom |
| **Screenshot Analysis** | Capture full screen or selected area, send to AI for instant analysis |
| **BYOK** | Bring Your Own Key — connect any AI or STT provider via curl |
| **Chat History** | All conversations stored locally in SQLite, never leaves your device |
| **System Prompts** | Create unlimited custom prompts to control AI behavior |
| **Hotkeys** | Fully customizable global keyboard shortcuts |
| **Stealth Cursor** | Invisible cursor mode so mouse movement is hidden from screen share |
| **~10MB Binary** | Built with Tauri + Rust — 27x smaller than Electron alternatives |
| **Free Forever** | No license key, no subscription, no paywalls — all features unlocked |

---

## Supported Platforms

| Platform | Status |
|---|---|
| Windows 10 / 11 | Supported (primary target) |
| macOS 12+ | Supported |
| Linux | Supported |

---

## Installation

### Download

Get the latest release from the [Releases page](https://github.com/Life2death/naukri-lelo/releases).

| Platform | Format |
|---|---|
| Windows | `.msi`, `.exe` |
| macOS | `.dmg` |
| Linux | `.deb`, `.rpm`, `.AppImage` |

### Build from Source

**Prerequisites:**
- [Node.js](https://nodejs.org/) v18+
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS

```bash
# Clone the repository
git clone https://github.com/Life2death/naukri-lelo.git
cd naukri-lelo

# Install dependencies
npm install

# Start development server
npm run tauri dev
```

**Build for production:**
```bash
npm run tauri build
```

Output is in `src-tauri/target/release/bundle/`.

---

## Quick Setup

1. Launch the app — the overlay appears at the top of your screen
2. Open Dashboard (`Ctrl+Shift+D`) → go to **Dev Space**
3. Add your AI provider (OpenAI, Anthropic, Gemini, Groq, Ollama, etc.) using a curl command
4. Add your STT provider for live transcription
5. Use `Ctrl+\` to toggle the overlay, `Ctrl+Shift+S` for screenshots

---

## Keyboard Shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Toggle Overlay | `Ctrl+\` | `Cmd+\` |
| Open Dashboard | `Ctrl+Shift+D` | `Cmd+Shift+D` |
| Focus Input | `Ctrl+Shift+I` | `Cmd+Shift+I` |
| System Audio | `Ctrl+Shift+M` | `Cmd+Shift+M` |
| Voice Input | `Ctrl+Shift+A` | `Cmd+Shift+A` |
| Screenshot | `Ctrl+Shift+S` | `Cmd+Shift+S` |
| Move Window | `Ctrl+Arrow Keys` | `Cmd+Arrow Keys` |

All shortcuts are fully customizable in the Shortcuts settings page.

---

## Supported AI Providers

Configure any of these via the Dev Space using curl commands:

- OpenAI (GPT-4o, GPT-4, etc.)
- Anthropic (Claude 3.5, Claude 4, etc.)
- Google Gemini
- xAI Grok
- Mistral AI
- Groq
- Ollama (local models)
- Perplexity
- Cohere
- Any OpenAI-compatible endpoint

## Supported STT Providers

- OpenAI Whisper
- Groq Whisper
- ElevenLabs
- Deepgram
- Azure Speech
- Google Speech-to-Text
- IBM Watson
- Any REST-based STT API

---

## Privacy

- All conversations stored **locally** in SQLite — never sent anywhere
- API keys stored in localStorage — sent **only** to your chosen provider
- No telemetry, no analytics, no tracking of any kind
- Zero dependency on any external server
- Full offline operation (except LLM API calls)

---

## BYOK — Custom Provider Setup

Add any AI provider using a curl command in Dev Space:

```bash
curl -X POST https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer {{API_KEY}}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "{{MODEL}}",
    "messages": [
      {"role": "system", "content": "{{SYSTEM_PROMPT}}"},
      {"role": "user", "content": "{{TEXT}}"}
    ],
    "stream": true
  }'
```

**Dynamic variables automatically replaced:**

| Variable | Description |
|---|---|
| `{{TEXT}}` | User's text input |
| `{{IMAGE}}` | Base64 encoded image |
| `{{SYSTEM_PROMPT}}` | System instructions |
| `{{MODEL}}` | AI model name |
| `{{API_KEY}}` | API key |
| `{{AUDIO}}` | Audio data (for STT) |
| `{{LANGUAGE}}` | Language setting |

---

## Why Naukri Lelo?

Existing tools like Cluely, Interview Coder, Final Round AI charge $20–$100/month for features that should be free. They lock basic functionality behind paywalls and subscriptions.

Naukri Lelo gives everything for free:
- No license activation
- No monthly subscription
- No feature gates
- No data sent to any third party
- Full source code available to audit

---

## Contributing

All contributions welcome.

1. Fork the repository
2. Create a feature branch (`git checkout -b fix/your-fix`)
3. Commit your changes (`git commit -m 'fix: description'`)
4. Push and open a Pull Request

Bug fixes, Windows compatibility improvements, new STT/AI provider presets, UI improvements — all welcome.

---

## License

Licensed under the **GNU General Public License v3.0** — see [LICENSE](LICENSE) for details.



---

## Acknowledgments


- **[Tauri](https://tauri.app/)** — desktop app framework
- **[tauri-nspanel](https://github.com/ahkohd/tauri-nspanel)** — macOS native panel integration
- **[shadcn/ui](https://ui.shadcn.com/)** — UI components
- **[@ricky0123/vad-react](https://github.com/ricky0123/vad)** — Voice Activity Detection

---

<div align="center">

**Free. Open Source. For everyone.**

[Issues](https://github.com/Life2death/naukri-lelo/issues) · [Discussions](https://github.com/Life2death/naukri-lelo/discussions) · [Releases](https://github.com/Life2death/naukri-lelo/releases)

</div>
