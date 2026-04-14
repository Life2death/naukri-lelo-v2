import { InterviewProfile } from "@/types";
import { getConversationById } from "@/lib/database/chat-history.action";

// Maximum characters to include in the injected context to avoid token overload
const MAX_CONTEXT_CHARS = 8000;
const MAX_RESUME_CHARS = 3000;
const MAX_GOALS_CHARS = 2000;
const MAX_DOC_CHARS = 800;
const MAX_REF_CONV_CHARS = 1500;
const MAX_REF_CONVS = 3;

/**
 * Builds a knowledge-hub system prompt prefix from the active interview profile.
 * Includes resume, custom documents, and any saved reference conversations.
 */
export function buildProfileKnowledgeContext(
  profile: InterviewProfile,
  refConvTexts?: string[]
): string {
  const parts: string[] = [
    `## Active Interview Profile: ${profile.name}`,
    "Use the following information as context when answering interview-related questions. Reference this profile to give tailored, specific answers.",
    "",
  ];

  if (profile.goals.trim()) {
    parts.push("### Target Role / Job Description");
    parts.push(profile.goals.trim().substring(0, MAX_GOALS_CHARS));
    parts.push("");
  }

  if (profile.resumeText.trim()) {
    const label = profile.resumeFileName
      ? `### Resume (${profile.resumeFileName})`
      : "### Resume";
    parts.push(label);
    parts.push(profile.resumeText.trim().substring(0, MAX_RESUME_CHARS));
    parts.push("");
  }

  if (profile.documents.length > 0) {
    parts.push("### Reference Documents");
    for (const doc of profile.documents) {
      parts.push(`**${doc.name}:**`);
      parts.push(doc.text.trim().substring(0, MAX_DOC_CHARS));
      parts.push("");
    }
  }

  if (refConvTexts && refConvTexts.length > 0) {
    parts.push("### Previous Interview Prep (Reference Knowledge)");
    parts.push("The following are insights from previous interview prep sessions for this profile. Use them to provide consistent, well-informed answers:");
    for (const text of refConvTexts.slice(0, MAX_REF_CONVS)) {
      parts.push(text.substring(0, MAX_REF_CONV_CHARS));
      parts.push("");
    }
  }

  parts.push("---");

  const context = parts.join("\n");
  return context.length > MAX_CONTEXT_CHARS
    ? context.substring(0, MAX_CONTEXT_CHARS) + "\n[...profile context truncated to fit limits...]"
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
 * a condensed text summary (only assistant messages) suitable for context injection.
 */
export async function loadProfileRefConvTexts(profileId: string): Promise<string[]> {
  const ids = getProfileRefConvIds(profileId);
  if (ids.length === 0) return [];

  const texts: string[] = [];
  for (const id of ids.slice(0, MAX_REF_CONVS)) {
    try {
      const conv = await getConversationById(id);
      if (!conv) continue;
      // Condense: title + assistant messages only
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
