import { STORAGE_KEYS } from "@/config";
import { JobProviderConfig, JobProviderId } from "@/types";

export function getJobProviderConfig(): JobProviderConfig | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.JOB_PROVIDER);
    if (!stored) return null;
    const parsed = JSON.parse(stored);

    // Migrate old single-key format: { provider, apiKey }
    if (parsed?.provider && parsed?.apiKey && !parsed?.activeProvider) {
      const migrated: JobProviderConfig = {
        activeProvider: parsed.provider as JobProviderId,
        tavilyKey: parsed.provider === "tavily" ? parsed.apiKey : "",
        serperKey: parsed.provider === "serper" ? parsed.apiKey : "",
      };
      localStorage.setItem(STORAGE_KEYS.JOB_PROVIDER, JSON.stringify(migrated));
      return migrated;
    }

    if (!parsed?.activeProvider) return null;
    return parsed as JobProviderConfig;
  } catch {
    return null;
  }
}

export function setJobProviderConfig(config: JobProviderConfig): void {
  try {
    localStorage.setItem(STORAGE_KEYS.JOB_PROVIDER, JSON.stringify(config));
  } catch {
    // ignore localStorage errors
  }
}

export function clearJobProviderConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.JOB_PROVIDER);
  } catch {}
}
