import { describe, it, expect, vi } from "vitest";
import { validateCurl } from "@/lib/curl-validator";

// Mock curl2Json: return a parsed object for valid curls, throw for invalid
vi.mock("@bany/curl-to-json", () => ({
  default: (curl: string) => {
    if (curl.includes("INVALID_SYNTAX:::")) throw new Error("parse error");
    return { url: "https://api.example.com", method: "POST" };
  },
}));

describe("validateCurl", () => {
  // ── must start with curl ───────────────────
  it("rejects a command that does not start with curl", () => {
    const result = validateCurl("wget https://api.example.com", []);
    expect(result.isValid).toBe(false);
    expect(result.message).toMatch(/must start with 'curl'/i);
  });

  it("rejects empty string", () => {
    const result = validateCurl("", []);
    expect(result.isValid).toBe(false);
  });

  it("rejects whitespace-only string", () => {
    const result = validateCurl("   ", []);
    expect(result.isValid).toBe(false);
  });

  // ── invalid curl syntax ────────────────────
  it("rejects a syntactically invalid curl command", () => {
    const result = validateCurl("curl INVALID_SYNTAX:::", []);
    expect(result.isValid).toBe(false);
    expect(result.message).toMatch(/invalid curl/i);
  });

  // ── required variable checks ───────────────
  it("passes when all required variables are present", () => {
    const curl = `curl -H "Authorization: Bearer {{API_KEY}}" -d '{"m":"{{MODEL}}"}'`;
    const result = validateCurl(curl, ["API_KEY", "MODEL"]);
    expect(result.isValid).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it("fails when a required variable is missing", () => {
    const curl = `curl -H "Authorization: Bearer {{API_KEY}}"`;
    const result = validateCurl(curl, ["API_KEY", "MODEL"]);
    expect(result.isValid).toBe(false);
    expect(result.message).toContain("{{MODEL}}");
  });

  it("fails when all required variables are missing", () => {
    const curl = `curl https://api.example.com`;
    const result = validateCurl(curl, ["API_KEY", "MODEL"]);
    expect(result.isValid).toBe(false);
    expect(result.message).toContain("{{API_KEY}}");
    expect(result.message).toContain("{{MODEL}}");
  });

  it("passes with no required variables (empty array)", () => {
    const curl = `curl https://api.example.com`;
    const result = validateCurl(curl, []);
    expect(result.isValid).toBe(true);
  });

  // ── edge cases ────────────────────────────
  it("is case-sensitive for variable names — {{api_key}} does not match {{API_KEY}}", () => {
    const curl = `curl -H "Bearer {{api_key}}"`;
    const result = validateCurl(curl, ["API_KEY"]);
    // {{api_key}} ≠ {{API_KEY}}
    expect(result.isValid).toBe(false);
  });

  it("lists all missing variables in the error message", () => {
    const curl = `curl -X POST https://api.test.com`;
    const result = validateCurl(curl, ["API_KEY", "MODEL", "ORG_ID"]);
    expect(result.message).toContain("{{API_KEY}}");
    expect(result.message).toContain("{{MODEL}}");
    expect(result.message).toContain("{{ORG_ID}}");
  });
});
