const STORAGE_KEY = "failover_enabled";
const CHAIN_KEY = "failover_chain";

export function getFailoverEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setFailoverEnabled(enabled: boolean): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {}
}

export function getFailoverChain(): string[] {
  try {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem(CHAIN_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function setFailoverChain(chain: string[]): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(CHAIN_KEY, JSON.stringify(chain));
  } catch {}
}
