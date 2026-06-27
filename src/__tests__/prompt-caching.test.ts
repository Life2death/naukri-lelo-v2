import { describe, it, expect } from "vitest";
import { AI_PROVIDERS } from "@/config/ai-providers.constants";
import { deepVariableReplacer } from "@/lib/functions/common.function";

// Use the real curl2Json for curl parsing
import curl2Json from "@bany/curl-to-json";

/**
 * Helper: FULL_CONTEXT_MODE logic extracted from useCompletion.ts.
 * Replicates the inline expression so we can unit-test it.
 */
function shouldUseFullContext(providerName: string, claudeProviderMatch: string): boolean {
  return providerName === claudeProviderMatch;
}

describe("B1 — Claude prompt caching curl template", () => {
  const claudeProvider = AI_PROVIDERS.find((p) => p.id === "claude");
  if (!claudeProvider) throw new Error("Claude provider not found");

  it("curl parses without error", () => {
    const result = curl2Json(claudeProvider.curl);
    expect(result).toBeDefined();
    expect(result.data).toBeDefined();
  });

  it("system field is a block array with cache_control after curl parse", () => {
    const parsed = curl2Json(claudeProvider.curl);
    expect(parsed.data.system).toBeInstanceOf(Array);
    expect(parsed.data.system).toHaveLength(1);
    expect(parsed.data.system[0].type).toBe("text");
    expect(parsed.data.system[0].text).toBe("{{SYSTEM_PROMPT}}");
    expect(parsed.data.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("deepVariableReplacer substitutes {{SYSTEM_PROMPT}} inside the block array", () => {
    const parsed = curl2Json(claudeProvider.curl);
    const variables = {
      API_KEY: "sk-ant-test123",
      MODEL: "claude-sonnet-4-20250514",
      SYSTEM_PROMPT: "You are a helpful interview assistant.",
    };
    const body = deepVariableReplacer(parsed.data, variables);
    // After substitution, system[0].text should contain the prompt
    expect(body.system[0].text).toBe("You are a helpful interview assistant.");
    // The cache_control structure should remain intact
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    // The overall JSON should still be valid
    expect(() => JSON.stringify(body)).not.toThrow();
  });

  it("included variables are substituted correctly (model, API key, etc)", () => {
    const parsed = curl2Json(claudeProvider.curl);
    const variables = {
      API_KEY: "sk-ant-test123",
      MODEL: "claude-sonnet-4-20250514",
      SYSTEM_PROMPT: "Test prompt",
    };
    const body = deepVariableReplacer(parsed.data, variables);
    const headers = deepVariableReplacer(parsed.header || {}, variables);
    expect(body.model).toBe("claude-sonnet-4-20250514");
    expect(headers["x-api-key"]).toBe("sk-ant-test123");
    expect(body.max_tokens).toBe(1024);
  });
});

describe("B1 — other providers are unchanged (string system)", () => {
  const claudeId = "claude";
  const nonClaudeProviders = AI_PROVIDERS.filter((p) => p.id !== claudeId);

  for (const provider of nonClaudeProviders) {
    it(`${provider.id} does not use a system block-array (caching) pattern`, () => {
      const parsed = curl2Json(provider.curl);
      const systemVal = parsed.data?.system;
      if (systemVal !== undefined) {
        // If system exists, it must not be a Claude-style caching block-array
        expect(typeof systemVal).not.toBe("object");
      }
      // Other providers may omit system entirely (handled via messages array),
      // or use different field names — that's fine, no cache_control block
    });
  }
});

describe("B1 — FULL_CONTEXT_MODE logic", () => {
  it("is true when provider is claude", () => {
    expect(shouldUseFullContext("claude", "claude")).toBe(true);
    expect(shouldUseFullContext("claude", "other")).toBe(false);
  });

  it("is false when provider is not claude", () => {
    expect(shouldUseFullContext("openrouter", "claude")).toBe(false);
    expect(shouldUseFullContext("openai", "claude")).toBe(false);
    expect(shouldUseFullContext("groq", "claude")).toBe(false);
    expect(shouldUseFullContext("cohere", "claude")).toBe(false);
    expect(shouldUseFullContext("google", "claude")).toBe(false);
    expect(shouldUseFullContext("deepseek", "claude")).toBe(false);
    expect(shouldUseFullContext("custom", "claude")).toBe(false);
  });
});
