import { InterviewProfile, TYPE_PROVIDER } from "@/types";
import { fetchAIResponse } from "./ai-response.function";

/** Generates a compact (<= ~300 token) candidate brief from a profile using the
 *  currently-selected AI provider. Returns "" on any failure (caller keeps old brief). */
export async function generateProfileBrief(args: {
  profile: InterviewProfile;
  provider: TYPE_PROVIDER;
  selectedProvider: { provider: string; variables: Record<string, string> };
}): Promise<string> {
  const { profile, provider, selectedProvider } = args;

  try {
    const resumeTruncated = (profile.resumeText || "").substring(0, 6000);
    const goalsTruncated = (profile.goals || "").substring(0, 3000);
    const docsTruncated = (profile.documents || [])
      .map((d) => `${d.name}:\n${d.text.substring(0, 2000)}`)
      .join("\n\n")
      .substring(0, 4000);

    const prompt = [
      "Compress the following candidate material into a concise interview brief of at most ~250 words / ~300 tokens. Output plain text only, no preamble. Include: top skills, 3–4 signature projects or quantified results, and the candidate's fit for the target role. Do not invent facts.",
      "",
      "---",
      "",
      goalsTruncated ? `Target Role / Job Description:\n${goalsTruncated}` : null,
      resumeTruncated ? `Resume:\n${resumeTruncated}` : null,
      docsTruncated ? `Reference Documents:\n${docsTruncated}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    let brief = "";
    for await (const chunk of fetchAIResponse({
      provider,
      selectedProvider,
      systemPrompt: undefined,
      history: [],
      userMessage: prompt,
    })) {
      brief += chunk;
    }

    return brief.trim();
  } catch (error) {
    console.warn("Failed to generate profile brief:", error);
    return "";
  }
}
