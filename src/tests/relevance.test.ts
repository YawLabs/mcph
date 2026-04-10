import { describe, expect, it } from "vitest";
import { scoreRelevance } from "../relevance.js";

describe("scoreRelevance", () => {
  const server = { name: "GitHub", namespace: "gh" };

  it("returns 0 for empty context", () => {
    expect(scoreRelevance("", server, [])).toBe(0);
  });

  it("returns 0 for context with only short words", () => {
    expect(scoreRelevance("go do it", server, [])).toBe(0);
  });

  it("scores server name matches", () => {
    const score = scoreRelevance("use github", server, []);
    expect(score).toBeGreaterThan(0);
  });

  it("scores namespace matches", () => {
    // "gh" is only 2 chars, filtered out by length > 2
    const server2 = { name: "Slack", namespace: "slack" };
    const score = scoreRelevance("check slack messages", server2, []);
    expect(score).toBeGreaterThan(0);
  });

  it("scores tool name matches", () => {
    const tools = [{ name: "create_issue", description: "Create a new issue" }];
    const score = scoreRelevance("create issue on github", server, tools);
    expect(score).toBeGreaterThan(0);
  });

  it("scores tool description matches", () => {
    const tools = [{ name: "run_query", description: "Execute a database query" }];
    const score = scoreRelevance("database query needed", { name: "DB", namespace: "db" }, tools);
    expect(score).toBeGreaterThan(0);
  });

  it("deduplicates words so repeats don't inflate score", () => {
    const singleScore = scoreRelevance("github tools", server, []);
    const repeatedScore = scoreRelevance("github github github tools", server, []);
    expect(repeatedScore).toBe(singleScore);
  });

  it("is case-insensitive", () => {
    const lower = scoreRelevance("github", server, []);
    const upper = scoreRelevance("GITHUB", server, []);
    expect(lower).toBe(upper);
  });

  it("returns 0 when no words match", () => {
    const score = scoreRelevance("completely unrelated query", server, []);
    expect(score).toBe(0);
  });

  it("strips non-alphanumeric characters from words", () => {
    const score = scoreRelevance("use (github)!", server, []);
    expect(score).toBeGreaterThan(0);
  });
});
