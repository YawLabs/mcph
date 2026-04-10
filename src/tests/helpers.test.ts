import { describe, expect, it } from "vitest";

// Test the helper functions exported or used in server.ts
// Since envEqual and resolveNamespaces are module-private, we test them via
// re-implementing the same logic here to validate the algorithm.

describe("envEqual logic", () => {
  function envEqual(a?: Record<string, string>, b?: Record<string, string>): boolean {
    if (!a && !b) return true;
    if (!a || !b) return false;
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => a[k] === b[k]);
  }

  it("returns true for both undefined", () => {
    expect(envEqual(undefined, undefined)).toBe(true);
  });

  it("returns false for one undefined", () => {
    expect(envEqual({ A: "1" }, undefined)).toBe(false);
    expect(envEqual(undefined, { A: "1" })).toBe(false);
  });

  it("returns true for identical objects", () => {
    expect(envEqual({ A: "1", B: "2" }, { A: "1", B: "2" })).toBe(true);
  });

  it("returns true for same keys in different order", () => {
    const a = { A: "1", B: "2" };
    const b = { B: "2", A: "1" };
    expect(envEqual(a, b)).toBe(true);
  });

  it("returns false for different values", () => {
    expect(envEqual({ A: "1" }, { A: "2" })).toBe(false);
  });

  it("returns false for different key counts", () => {
    expect(envEqual({ A: "1" }, { A: "1", B: "2" })).toBe(false);
  });

  it("returns false when a has key not in b", () => {
    expect(envEqual({ A: "1", C: "3" }, { A: "1", B: "2" })).toBe(false);
  });

  it("returns true for empty objects", () => {
    expect(envEqual({}, {})).toBe(true);
  });
});

describe("resolveNamespaces logic", () => {
  function resolveNamespaces(args: Record<string, unknown>): string[] {
    if (Array.isArray(args.servers) && args.servers.length > 0) {
      return args.servers as string[];
    }
    if (typeof args.server === "string" && args.server) {
      return [args.server];
    }
    return [];
  }

  it("returns single server as array", () => {
    expect(resolveNamespaces({ server: "gh" })).toEqual(["gh"]);
  });

  it("returns servers array", () => {
    expect(resolveNamespaces({ servers: ["gh", "slack"] })).toEqual(["gh", "slack"]);
  });

  it("prefers servers over server", () => {
    expect(resolveNamespaces({ server: "gh", servers: ["slack", "stripe"] })).toEqual(["slack", "stripe"]);
  });

  it("returns empty for no args", () => {
    expect(resolveNamespaces({})).toEqual([]);
  });

  it("returns empty for empty string", () => {
    expect(resolveNamespaces({ server: "" })).toEqual([]);
  });

  it("returns empty for empty array", () => {
    expect(resolveNamespaces({ servers: [] })).toEqual([]);
  });
});

describe("namespace sanitization logic", () => {
  function sanitize(key: string): string {
    return key
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30);
  }

  it("lowercases and replaces special chars", () => {
    expect(sanitize("My GitHub Server")).toBe("my_github_server");
  });

  it("strips leading/trailing underscores", () => {
    expect(sanitize("---MCP---")).toBe("mcp");
  });

  it("truncates to 30 characters", () => {
    const long = "a".repeat(50);
    expect(sanitize(long).length).toBe(30);
  });

  it("returns empty for all-special-char names", () => {
    expect(sanitize("!!!")).toBe("");
  });

  it("detects collisions", () => {
    expect(sanitize("Server A")).toBe(sanitize("Server-A"));
  });
});
