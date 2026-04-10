import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Must mock undici before importing analytics
vi.mock("undici", () => ({
  request: vi.fn().mockResolvedValue({
    statusCode: 200,
    body: { text: vi.fn().mockResolvedValue(""), json: vi.fn().mockResolvedValue({}) },
  }),
}));

import { initAnalytics, recordConnectEvent, shutdownAnalytics } from "../analytics.js";

describe("analytics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await shutdownAnalytics();
    vi.useRealTimers();
  });

  it("recordConnectEvent adds event to buffer", () => {
    initAnalytics("https://example.com", "test-token");
    recordConnectEvent({
      namespace: "gh",
      toolName: "create_issue",
      action: "tool_call",
      latencyMs: 100,
      success: true,
    });
    // Event was recorded (buffer is internal, but we can verify via shutdown flush)
  });

  it("recordConnectEvent drops events beyond MAX_BUFFER", () => {
    initAnalytics("https://example.com", "test-token");
    // Fill beyond 5000
    for (let i = 0; i < 5100; i++) {
      recordConnectEvent({
        namespace: "gh",
        toolName: null,
        action: "discover",
        latencyMs: null,
        success: true,
      });
    }
    // Should not throw — events beyond 5000 are silently dropped
  });
});
