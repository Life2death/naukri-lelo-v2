import { InterviewProfile } from "@/types";
import { getConversationById } from "@/lib/database/chat-history.action";

// Generous limits — modern LLMs handle 100k+ tokens; 24k chars ≈ 6k tokens, well within range
const MAX_CONTEXT_CHARS = 24000;
const MAX_RESUME_CHARS = 6000;
const MAX_GOALS_CHARS = 3000;
const MAX_DOC_CHARS = 6000; // enough for 30–50 Q&As per document
const MAX_REF_CONV_CHARS = 2000;
const MAX_REF_CONVS = 3;

/**
 * Builds a knowledge-hub system prompt prefix from the active interview profile.
 *
 * The returned string is prepended to whatever system prompt the user has configured
 * so that EVERY AI call in the overlay uses the candidate's resume, documents, and
 * reference conversations as grounding data.
 *
 * The opening persona block is critical: it instructs the AI to respond in the
 * first person AS the candidate, not as a generic assistant. Without this,
 * Claude and most LLMs will ignore the profile data and stay in assistant mode.
 */
export function buildProfileKnowledgeContext(
  profile: InterviewProfile,
  refConvTexts?: string[]
): string {
  const parts: string[] = [];

  // ── Persona instruction ──────────────────────────────────────────────────
  // This is the most important block. Without an explicit role instruction,
  // Claude will respond as "an AI assistant" even when profile data is present.
  const firstName =
    profile.firstName && profile.firstName.trim()
      ? profile.firstName.trim()
      : profile.name.split(" ")[0] || profile.name;

  parts.push(`=== INTERVIEW ASSISTANT MODE ===`);

  if (profile.persona && profile.persona.trim()) {
    // Use the AI-generated (or manually written) persona stored on the profile.
    // This is the richest, most personalised instruction.
    parts.push(
      `You are ${firstName} in a live job interview. Stay in character at all times. ` +
        `Answer EVERY question in the first person as ${firstName}. ` +
        `Do NOT say "I'm Claude", "As an AI", or anything that breaks the persona. ` +
        `You ARE ${firstName} for this entire conversation.\n\n` +
        `Your introduction / persona:\n${profile.persona.trim()}`
    );
  } else {
    // Fallback: build persona from raw profile data when no generated persona exists.
    parts.push(
      `You are acting as a job candidate named "${profile.name}" during a live job interview. ` +
        `Answer EVERY question in the first person as ${firstName}. ` +
        `Use the resume, job description, documents, and preparation notes below to give ` +
        `specific, accurate, personalised answers grounded in real experiences and skills. ` +
        `Do NOT present yourself as an AI. Do NOT say "I'm Claude" or "As an AI". ` +
        `You ARE ${firstName} for this entire conversation. ` +
        `When asked "tell me about yourself", introduce yourself as ${firstName} using your background from the resume below.`
    );
  }
  parts.push(``);

  // ── Target role / job description ────────────────────────────────────────
  if (profile.goals && profile.goals.trim()) {
    parts.push(`--- Target Role / Job Description ---`);
    parts.push(profile.goals.trim().substring(0, MAX_GOALS_CHARS));
    parts.push(``);
  }

  // ── Resume ───────────────────────────────────────────────────────────────
  if (profile.resumeText && profile.resumeText.trim()) {
    const label = profile.resumeFileName
      ? `--- Resume (${profile.resumeFileName}) ---`
      : `--- Resume ---`;
    parts.push(label);
    parts.push(profile.resumeText.trim().substring(0, MAX_RESUME_CHARS));
    parts.push(``);
  }

  // ── Custom documents (Q&A, interview prep, etc.) ─────────────────────────
  if (profile.documents && profile.documents.length > 0) {
    parts.push(`--- Preparation Documents ---`);
    for (const doc of profile.documents) {
      parts.push(`[${doc.name}]`);
      parts.push(doc.text.trim().substring(0, MAX_DOC_CHARS));
      parts.push(``);
    }
  }

  // ── Reference conversations from previous prep sessions ──────────────────
  if (refConvTexts && refConvTexts.length > 0) {
    parts.push(`--- Previous Interview Prep (Reference Knowledge) ---`);
    parts.push(
      `Use the following answers from earlier prep sessions for consistency and depth:`
    );
    for (const text of refConvTexts.slice(0, MAX_REF_CONVS)) {
      parts.push(text.substring(0, MAX_REF_CONV_CHARS));
      parts.push(``);
    }
  }

  parts.push(`=== END OF CANDIDATE PROFILE ===`);
  parts.push(``);

  const context = parts.join("\n");

  // Hard cap: if still over limit, truncate with a note
  return context.length > MAX_CONTEXT_CHARS
    ? context.substring(0, MAX_CONTEXT_CHARS) +
        "\n[...profile context truncated — consider splitting large documents into smaller files...]"
    : context;
}

/** localStorage key for storing conversation IDs referenced by a profile */
function profileRefsKey(profileId: string): string {
  return `profile_refs_${profileId}`;
}

/** Returns conversation IDs saved as reference for the given profile */
export function getProfileRefConvIds(profileId: string): string[] {
  try {
    const stored = localStorage.getItem(profileRefsKey(profileId));
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Saves a conversation ID as a reference for the given profile (deduped, max 10) */
export function addProfileRefConvId(profileId: string, convId: string): void {
  try {
    const existing = getProfileRefConvIds(profileId);
    if (existing.includes(convId)) return;
    const updated = [convId, ...existing].slice(0, 10);
    localStorage.setItem(profileRefsKey(profileId), JSON.stringify(updated));
  } catch {
    // ignore localStorage errors
  }
}

/**
 * Loads reference conversations from SQLite for the given profile and returns
 * a condensed text (assistant messages only) suitable for context injection.
 */
export async function loadProfileRefConvTexts(
  profileId: string
): Promise<string[]> {
  const ids = getProfileRefConvIds(profileId);
  if (ids.length === 0) return [];

  const texts: string[] = [];
  for (const id of ids.slice(0, MAX_REF_CONVS)) {
    try {
      const conv = await getConversationById(id);
      if (!conv) continue;
      const assistantLines = conv.messages
        .filter((m) => m.role === "assistant" && m.content.trim())
        .map((m) => m.content.trim())
        .join("\n\n");
      if (assistantLines) {
        texts.push(`[${conv.title}]\n${assistantLines}`);
      }
    } catch {
      // skip failed loads
    }
  }
  return texts;
}
