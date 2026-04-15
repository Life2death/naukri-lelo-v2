import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { JobListing, JobProviderConfig, TYPE_PROVIDER } from "@/types";
import { fetchAIResponse } from "./ai-response.function";

// ─── Tavily ──────────────────────────────────────────────────────────────────

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

async function searchViaTavily(
  apiKey: string,
  query: string
): Promise<JobListing[]> {
  const res = await tauriFetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      max_results: 15,
      include_raw_content: false,
      include_domains: [
        "linkedin.com",
        "naukri.com",
        "indeed.com",
        "glassdoor.com",
        "wellfound.com",
        "unstop.com",
        "internshala.com",
        "monster.com",
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily error ${res.status}: ${text}`);
  }

  const data: TavilyResponse = await res.json();
  return (data.results || []).map((r, i) => ({
    id: `tavily-${i}-${Date.now()}`,
    title: r.title,
    company: extractCompanyFromTitle(r.title),
    location: extractLocationFromSnippet(r.content),
    snippet: r.content?.substring(0, 300) || "",
    url: r.url,
    via: extractDomainLabel(r.url),
    postedAt: r.published_date,
  }));
}

// ─── Serper ──────────────────────────────────────────────────────────────────

interface SerperJob {
  title: string;
  company_name: string;
  location: string;
  via: string;
  description?: string;
  link?: string;
  detected_extensions?: {
    posted_at?: string;
    schedule_type?: string;
    salary?: string;
  };
  apply_options?: { title: string; link: string }[];
}

interface SerperResponse {
  jobs?: SerperJob[];
}

async function searchViaSerper(
  apiKey: string,
  query: string
): Promise<JobListing[]> {
  const res = await tauriFetch("https://google.serper.dev/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query, num: 20 }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Serper error ${res.status}: ${text}`);
  }

  const data: SerperResponse = await res.json();
  return (data.jobs || []).map((j, i) => ({
    id: `serper-${i}-${Date.now()}`,
    title: j.title,
    company: j.company_name,
    location: j.location,
    snippet: j.description?.substring(0, 300) || "",
    url: j.link || j.apply_options?.[0]?.link || "",
    via: j.via,
    postedAt: j.detected_extensions?.posted_at,
    salary: j.detected_extensions?.salary,
    scheduleType: j.detected_extensions?.schedule_type,
  }));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Search for jobs using the configured provider (Tavily or Serper).
 * Returns raw listings without match scores — call scoreJobWithAI() separately.
 */
export async function searchJobs(
  config: JobProviderConfig,
  query: string
): Promise<JobListing[]> {
  if (config.activeProvider === "tavily") {
    return searchViaTavily(config.tavilyKey, query);
  }
  return searchViaSerper(config.serperKey, query);
}

/**
 * Builds a job search query from the user's profile goals + title hint.
 * Example: "senior react engineer jobs india remote OR hybrid"
 */
export function buildJobQuery(
  titleOrKeywords: string,
  location: string,
  skills?: string[]
): string {
  const parts: string[] = [];

  if (titleOrKeywords.trim()) {
    parts.push(titleOrKeywords.trim());
  }

  if (skills && skills.length > 0) {
    parts.push(`skills: ${skills.slice(0, 6).join(", ")}`);
  }

  if (location.trim()) parts.push(`in ${location.trim()}`);

  parts.push("jobs");
  return parts.join(" ");
}

/**
 * Score a single job listing against the candidate's resume using their
 * configured AI provider.  Returns 0-100.  Streams are consumed silently
 * to extract the final JSON.
 */
export async function scoreJobWithAI(
  job: JobListing,
  resumeText: string,
  provider: TYPE_PROVIDER,
  selectedProvider: { provider: string; variables: Record<string, string> }
): Promise<number> {
  const prompt =
    `You are a professional recruiter. Score how well this candidate matches the job.\n\n` +
    `=== JOB POSTING ===\n` +
    `Title: ${job.title}\n` +
    `Company: ${job.company}\n` +
    `Location: ${job.location}\n` +
    `Description: ${job.snippet}\n\n` +
    `=== CANDIDATE RESUME (excerpt) ===\n` +
    `${resumeText.substring(0, 1500)}\n\n` +
    `Return ONLY a JSON object like: {"score": 72}\n` +
    `Score from 0 (no match) to 100 (perfect match). Consider skills, seniority, domain.`;

  let fullResponse = "";
  for await (const chunk of fetchAIResponse({
    provider,
    selectedProvider,
    systemPrompt: undefined,
    history: [],
    userMessage: prompt,
    imagesBase64: [],
  })) {
    fullResponse += chunk;
  }

  try {
    // Extract JSON from the response (handles markdown code blocks too)
    const jsonMatch = fullResponse.match(/\{[^}]*"score"\s*:\s*(\d+)[^}]*\}/);
    if (jsonMatch) {
      const score = parseInt(jsonMatch[1], 10);
      return Math.min(100, Math.max(0, score));
    }
    // Fallback: look for any standalone number in 0-100 range
    const numMatch = fullResponse.match(/\b([0-9]{1,3})\b/);
    if (numMatch) {
      const n = parseInt(numMatch[1], 10);
      if (n >= 0 && n <= 100) return n;
    }
  } catch {}
  return 50; // Default neutral score on parse failure
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractCompanyFromTitle(title: string): string {
  // "Senior Engineer at TechCorp" → "TechCorp"
  const atMatch = title.match(/ at (.+)$/i);
  if (atMatch) return atMatch[1].trim();
  const dashMatch = title.match(/ [-–] (.+)$/);
  if (dashMatch) return dashMatch[1].trim();
  return "";
}

function extractLocationFromSnippet(text: string): string {
  const match = text.match(/\b([A-Z][a-z]+(?:,\s*[A-Z]{2,})?)\b/);
  return match ? match[1] : "";
}

function extractDomainLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    const domain = host.split(".")[0];
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch {
    return "";
  }
}

export const SKILL_KEYWORDS = [
  "react","vue","angular","typescript","javascript","python","java","golang","rust",
  "node","express","nextjs","graphql","rest","sql","postgres","mysql","mongodb",
  "redis","aws","gcp","azure","docker","kubernetes","terraform","ci/cd","git",
  "linux","android","ios","swift","kotlin","flutter","dart","ruby","rails",
  "django","fastapi","spring","c++","c#",".net","php","laravel","scala",
  "kafka","rabbitmq","elasticsearch","redis","spark","hadoop","airflow","mlops",
  "pytorch","tensorflow","scikit-learn","pandas","numpy","openai","llm","langchain",
];

export function extractTopSkills(text: string, max: number = 10): string[] {
  const lower = text.toLowerCase();
  return SKILL_KEYWORDS
    .filter((k) => lower.includes(k))
    .slice(0, max);
}
