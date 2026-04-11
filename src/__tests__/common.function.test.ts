import { describe, it, expect } from "vitest";
import {
  getByPath,
  setByPath,
  extractVariables,
  deepVariableReplacer,
  buildDynamicMessages,
  processUserMessageTemplate,
  getStreamingContent,
} from "@/lib/functions/common.function";

// ─────────────────────────────────────────────
// getByPath
// ─────────────────────────────────────────────
describe("getByPath", () => {
  it("returns the top-level value by key", () => {
    expect(getByPath({ text: "hello" }, "text")).toBe("hello");
  });

  it("navigates nested objects with dot notation", () => {
    const obj = { choices: [{ message: { content: "hi" } }] };
    expect(getByPath(obj, "choices[0].message.content")).toBe("hi");
  });

  it("handles bracket array index notation", () => {
    const obj = { items: ["a", "b", "c"] };
    expect(getByPath(obj, "items[2]")).toBe("c");
  });

  it("returns undefined for missing path", () => {
    expect(getByPath({ a: 1 }, "b.c")).toBeUndefined();
  });

  it("returns the full object when path is empty string", () => {
    const obj = { x: 1 };
    expect(getByPath(obj, "")).toEqual({ x: 1 });
  });

  it("handles Gemini-style deep path", () => {
    const obj = { candidates: [{ content: { parts: [{ text: "gemini" }] } }] };
    expect(getByPath(obj, "candidates[0].content.parts[0].text")).toBe("gemini");
  });

  it("returns undefined gracefully when intermediate key missing", () => {
    expect(getByPath({}, "choices[0].delta.content")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// setByPath
// ─────────────────────────────────────────────
describe("setByPath", () => {
  it("sets a top-level key", () => {
    const obj: any = {};
    setByPath(obj, "name", "Naukri Lelo");
    expect(obj.name).toBe("Naukri Lelo");
  });

  it("sets a nested key (auto-creates intermediate objects)", () => {
    const obj: any = {};
    setByPath(obj, "a.b.c", 42);
    expect(obj.a.b.c).toBe(42);
  });

  it("overwrites an existing value", () => {
    const obj: any = { x: 1 };
    setByPath(obj, "x", 99);
    expect(obj.x).toBe(99);
  });
});

// ─────────────────────────────────────────────
// extractVariables
// ─────────────────────────────────────────────
describe("extractVariables", () => {
  it("extracts custom variables from curl command", () => {
    const curl = `curl -H "Authorization: Bearer {{API_KEY}}" -d '{"model":"{{MODEL}}"}'`;
    const vars = extractVariables(curl);
    const keys = vars.map((v) => v.value);
    expect(keys).toContain("API_KEY");
    expect(keys).toContain("MODEL");
  });

  it("excludes built-in reserved variables by default", () => {
    const curl = `curl -d '{"messages":{{TEXT}},"image":"{{IMAGE}}","system":"{{SYSTEM_PROMPT}}","audio":"{{AUDIO}}"}'`;
    const vars = extractVariables(curl);
    const values = vars.map((v) => v.value);
    expect(values).not.toContain("TEXT");
    expect(values).not.toContain("IMAGE");
    expect(values).not.toContain("SYSTEM_PROMPT");
    expect(values).not.toContain("AUDIO");
  });

  it("includes reserved variables when includeAll=true", () => {
    const curl = `curl -d '{"m":"{{TEXT}}","k":"{{API_KEY}}"}'`;
    const vars = extractVariables(curl, true);
    const values = vars.map((v) => v.value);
    expect(values).toContain("TEXT");
    expect(values).toContain("API_KEY");
  });

  it("deduplicates repeated variables", () => {
    const curl = `curl -H "Bearer {{API_KEY}}" -d '{"key":"{{API_KEY}}"}'`;
    const vars = extractVariables(curl);
    const keys = vars.map((v) => v.value);
    expect(keys.filter((k) => k === "API_KEY").length).toBe(1);
  });

  it("returns empty array for non-string input", () => {
    expect(extractVariables(null as any)).toEqual([]);
  });

  it("returns empty array when no variables present", () => {
    const curl = `curl -X POST https://api.example.com/v1/chat`;
    expect(extractVariables(curl)).toEqual([]);
  });
});

// ─────────────────────────────────────────────
// deepVariableReplacer
// ─────────────────────────────────────────────
describe("deepVariableReplacer", () => {
  it("replaces a variable in a plain string", () => {
    const result = deepVariableReplacer("Bearer {{API_KEY}}", { API_KEY: "sk-abc" });
    expect(result).toBe("Bearer sk-abc");
  });

  it("replaces multiple variables in an object", () => {
    const obj = { auth: "Bearer {{API_KEY}}", model: "{{MODEL}}" };
    const result = deepVariableReplacer(obj, { API_KEY: "sk-xyz", MODEL: "gpt-4o" });
    expect(result).toEqual({ auth: "Bearer sk-xyz", model: "gpt-4o" });
  });

  it("recursively replaces in nested objects", () => {
    const obj = { a: { b: { c: "{{VAR}}" } } };
    const result = deepVariableReplacer(obj, { VAR: "replaced" });
    expect(result.a.b.c).toBe("replaced");
  });

  it("recursively replaces in arrays", () => {
    const arr = ["{{X}}", "{{Y}}"];
    const result = deepVariableReplacer(arr, { X: "hello", Y: "world" });
    expect(result).toEqual(["hello", "world"]);
  });

  it("replaces all occurrences in a string (global replace)", () => {
    const result = deepVariableReplacer("{{A}} and {{A}}", { A: "foo" });
    expect(result).toBe("foo and foo");
  });

  it("leaves unreplaced variables if key not in map", () => {
    const result = deepVariableReplacer("{{UNKNOWN}}", { OTHER: "val" });
    expect(result).toBe("{{UNKNOWN}}");
  });

  it("passes through numbers and booleans unchanged", () => {
    expect(deepVariableReplacer(42, {})).toBe(42);
    expect(deepVariableReplacer(true, {})).toBe(true);
    expect(deepVariableReplacer(null, {})).toBeNull();
  });

  it("handles special regex characters in values safely", () => {
    const result = deepVariableReplacer("{{KEY}}", { KEY: "value$1" });
    expect(result).toBe("value$1");
  });
});

// ─────────────────────────────────────────────
// processUserMessageTemplate
// ─────────────────────────────────────────────
describe("processUserMessageTemplate", () => {
  it("replaces {{TEXT}} in a simple string template", () => {
    const result = processUserMessageTemplate({ role: "user", content: "{{TEXT}}" }, "Hello AI");
    expect(result.content).toBe("Hello AI");
  });

  it("escapes special JSON characters in the message", () => {
    const result = processUserMessageTemplate({ content: "{{TEXT}}" }, `He said "hi"`);
    expect(result.content).toBe(`He said "hi"`);
  });

  it("inserts image parts when images provided", () => {
    const template = {
      role: "user",
      content: [
        { type: "text", text: "{{TEXT}}" },
        { type: "image_url", image_url: { url: "data:image/png;base64,{{IMAGE}}" } },
      ],
    };
    const result = processUserMessageTemplate(template, "describe this", ["abc123"]);
    const contentArr = result.content;
    expect(contentArr[0].text).toBe("describe this");
    expect(contentArr[1].image_url.url).toBe("data:image/png;base64,abc123");
  });

  it("removes image template slots when no images provided", () => {
    const template = {
      role: "user",
      content: [
        { type: "text", text: "{{TEXT}}" },
        { type: "image_url", image_url: { url: "{{IMAGE}}" } },
      ],
    };
    const result = processUserMessageTemplate(template, "text only", []);
    // Image slot removed; only text part remains
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe("text only");
  });

  it("expands multiple images into multiple slots", () => {
    const template = {
      role: "user",
      content: [
        { type: "text", text: "{{TEXT}}" },
        { type: "image_url", image_url: { url: "{{IMAGE}}" } },
      ],
    };
    const result = processUserMessageTemplate(template, "compare", ["img1", "img2"]);
    expect(result.content).toHaveLength(3); // 1 text + 2 images
  });
});

// ─────────────────────────────────────────────
// buildDynamicMessages
// ─────────────────────────────────────────────
describe("buildDynamicMessages", () => {
  const sysMessage = { role: "system", content: "{{SYSTEM_PROMPT}}" };
  const userTemplate = { role: "user", content: "{{TEXT}}" };

  it("builds messages with prefix, history, and user message", () => {
    const history = [{ role: "user" as const, content: "prev", timestamp: 0 }];
    const result = buildDynamicMessages([sysMessage, userTemplate], history, "hello");
    expect(result[0]).toEqual(sysMessage);
    expect(result[1]).toEqual(history[0]);
    expect(result[2].content).toBe("hello");
  });

  it("falls back gracefully when no {{TEXT}} in template", () => {
    const template = [{ role: "user", content: "hardcoded" }];
    const history = [{ role: "assistant" as const, content: "prev", timestamp: 0 }];
    const result = buildDynamicMessages(template, history, "new message");
    expect(result).toContainEqual({ role: "user", content: "new message" });
  });

  it("handles empty history correctly", () => {
    const result = buildDynamicMessages([userTemplate], [], "first message");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("first message");
  });

  it("places history between prefix and user message", () => {
    const prefix = { role: "system", content: "system" };
    const histItem = { role: "assistant" as const, content: "prev answer", timestamp: 0 };
    const result = buildDynamicMessages([prefix, userTemplate], [histItem], "follow-up");
    expect(result[0]).toEqual(prefix);
    expect(result[1]).toEqual(histItem);
    expect(result[2].content).toBe("follow-up");
  });
});

// ─────────────────────────────────────────────
// getStreamingContent
// ─────────────────────────────────────────────
describe("getStreamingContent", () => {
  it("extracts OpenAI streaming delta content", () => {
    const chunk = { choices: [{ delta: { content: "Hello" } }] };
    expect(getStreamingContent(chunk, "choices[0].message.content")).toBe("Hello");
  });

  it("extracts Gemini streaming content", () => {
    const chunk = { candidates: [{ content: { parts: [{ text: "Gemini reply" }] } }] };
    expect(getStreamingContent(chunk, "candidates[0].content.parts[0].text")).toBe("Gemini reply");
  });

  it("extracts Claude streaming delta.text", () => {
    const chunk = { delta: { text: "Claude chunk" } };
    expect(getStreamingContent(chunk, "something.else")).toBe("Claude chunk");
  });

  it("extracts Cohere text field", () => {
    const chunk = { text: "Cohere reply" };
    expect(getStreamingContent(chunk, "text")).toBe("Cohere reply");
  });

  it("returns null when no matching path found", () => {
    const chunk = { unknown: { key: "value" } };
    expect(getStreamingContent(chunk, "some.unknown.path")).toBeNull();
  });

  it("ignores paths that resolve to objects rather than strings", () => {
    const chunk = { choices: [{ delta: { content: "" } }] };
    // content is empty string → should not return it
    expect(getStreamingContent(chunk, "choices[0].message.content")).toBeNull();
  });

  it("tries defaultPath as last resort", () => {
    const chunk = { custom: { field: "custom response" } };
    expect(getStreamingContent(chunk, "custom.field")).toBe("custom response");
  });
});
