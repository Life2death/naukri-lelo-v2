export type JobProviderId = "tavily" | "serper";

export interface JobProviderConfig {
  provider: JobProviderId;
  apiKey: string;
}

export interface JobListing {
  id: string;
  title: string;
  company: string;
  location: string;
  snippet: string;
  url: string;
  via?: string;           // e.g. "LinkedIn", "Naukri"
  postedAt?: string;      // e.g. "2 days ago"
  salary?: string;
  scheduleType?: string;  // "Full-time", "Contract", etc.
  matchScore?: number;    // 0-100, computed locally
  isScoring?: boolean;    // true while AI is computing the score
}
