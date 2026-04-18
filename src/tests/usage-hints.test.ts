import { describe, expect, it } from "vitest";
import type { NamespaceUsage } from "../learning.js";
import type { DetectedPack } from "../pack-detect.js";
import { buildCoUsageMap, formatUsageHint } from "../usage-hints.js";

function usage(succeeded: number, dispatched?: number): NamespaceUsage {
  return { succeeded, dispatched: dispatched ?? succeeded, lastUsedAt: 1 };
}

describe("buildCoUsageMap", () => {
  it("returns an empty map when there are no packs", () => {
    expect(buildCoUsageMap([])).toEqual(new Map());
  });

  it("lists peers for each namespace in a 2-server pack", () => {
    const packs: DetectedPack[] = [{ namespaces: ["gh", "linear"], frequency: 2, lastSeenAt: 100 }];
    const m = buildCoUsageMap(packs);
    expect(m.get("gh")).toEqual(["linear"]);
    expect(m.get("linear")).toEqual(["gh"]);
  });

  it("handles 3-server packs and dedupes across multiple packs", () => {
    const packs: DetectedPack[] = [
      { namespaces: ["gh", "linear", "slack"], frequency: 2, lastSeenAt: 100 },
      { namespaces: ["gh", "linear"], frequency: 3, lastSeenAt: 200 },
    ];
    const m = buildCoUsageMap(packs);
    expect(m.get("gh")).toEqual(["linear", "slack"]);
    expect(m.get("linear")).toEqual(["gh", "slack"]);
    expect(m.get("slack")).toEqual(["gh", "linear"]);
  });

  it("sorts peers alphabetically for stable output", () => {
    const packs: DetectedPack[] = [{ namespaces: ["zzz", "aaa", "mmm"], frequency: 2, lastSeenAt: 100 }];
    const m = buildCoUsageMap(packs);
    expect(m.get("zzz")).toEqual(["aaa", "mmm"]);
  });
});

describe("formatUsageHint", () => {
  it("returns null when there are no signals", () => {
    expect(formatUsageHint(undefined, [])).toBeNull();
  });

  it("returns null when usage exists but succeeded is 0", () => {
    expect(formatUsageHint(usage(0, 4), [])).toBeNull();
  });

  it("renders a success count", () => {
    expect(formatUsageHint(usage(4), [])).toBe("usage: used 4x this session");
  });

  it("renders co-usage peers", () => {
    expect(formatUsageHint(undefined, ["linear", "slack"])).toBe('usage: often loaded with "linear", "slack"');
  });

  it("renders both signals joined", () => {
    expect(formatUsageHint(usage(3), ["slack"])).toBe('usage: used 3x this session; often loaded with "slack"');
  });

  it("caps peers at 3 and shows a +N more suffix for overflow", () => {
    const hint = formatUsageHint(undefined, ["a", "b", "c", "d", "e"]);
    expect(hint).toBe('usage: often loaded with "a", "b", "c" +2 more');
  });

  it("does not show +N more when exactly at the cap", () => {
    const hint = formatUsageHint(undefined, ["a", "b", "c"]);
    expect(hint).toBe('usage: often loaded with "a", "b", "c"');
  });
});
