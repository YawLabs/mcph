import { describe, expect, it } from "vitest";
import type { NamespaceUsage } from "../learning.js";
import type { DetectedPack } from "../pack-detect.js";
import { buildCoUsageMap, formatReliabilityWarning, formatUsageHint, selectFlakyNamespaces } from "../usage-hints.js";

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
    expect(formatUsageHint(usage(4), [])).toBe("usage: used 4x");
  });

  it("renders co-usage peers", () => {
    expect(formatUsageHint(undefined, ["linear", "slack"])).toBe('usage: often loaded with "linear", "slack"');
  });

  it("renders both signals joined", () => {
    expect(formatUsageHint(usage(3), ["slack"])).toBe('usage: used 3x; often loaded with "slack"');
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

describe("formatReliabilityWarning", () => {
  it("returns null when no usage data exists", () => {
    expect(formatReliabilityWarning(undefined)).toBeNull();
  });

  it("returns null when dispatched count is below the minimum", () => {
    expect(formatReliabilityWarning(usage(0, 2))).toBeNull();
  });

  it("returns null when success rate is at or above 80%", () => {
    expect(formatReliabilityWarning(usage(4, 5))).toBeNull();
    expect(formatReliabilityWarning(usage(5, 5))).toBeNull();
  });

  it("warns when success rate is below 80% with enough observations", () => {
    expect(formatReliabilityWarning(usage(5, 10))).toBe("reliability: 50% success across 10 past calls");
  });

  it("warns on 0% success rate", () => {
    expect(formatReliabilityWarning(usage(0, 4))).toBe("reliability: 0% success across 4 past calls");
  });

  it("rounds the success rate to a whole percent", () => {
    expect(formatReliabilityWarning(usage(1, 3))).toBe("reliability: 33% success across 3 past calls");
  });
});

describe("selectFlakyNamespaces", () => {
  it("returns an empty list when the input is empty", () => {
    expect(selectFlakyNamespaces([], 5)).toEqual([]);
  });

  it("returns an empty list when limit is zero", () => {
    expect(selectFlakyNamespaces([{ namespace: "flaky", usage: usage(2, 10) }], 0)).toEqual([]);
  });

  it("excludes namespaces below the observation floor", () => {
    const out = selectFlakyNamespaces([{ namespace: "rare", usage: usage(0, 2) }], 5);
    expect(out).toEqual([]);
  });

  it("excludes namespaces at or above the 80% success threshold", () => {
    const out = selectFlakyNamespaces(
      [
        { namespace: "solid", usage: usage(8, 10) }, // 80% exactly
        { namespace: "perfect", usage: usage(5, 5) },
      ],
      5,
    );
    expect(out).toEqual([]);
  });

  it("sorts worst-rate first, then highest dispatched, then alpha", () => {
    const out = selectFlakyNamespaces(
      [
        { namespace: "mild", usage: usage(7, 10) }, // 70%
        { namespace: "severe", usage: usage(1, 5) }, // 20%
        { namespace: "tied-fewer", usage: usage(1, 2) }, // 50% (below floor, filtered)
        { namespace: "tied-more", usage: usage(5, 10) }, // 50%
        { namespace: "tied-most", usage: usage(10, 20) }, // 50%
      ],
      5,
    );
    const names = out.map((e) => e.namespace);
    expect(names).toEqual(["severe", "tied-most", "tied-more", "mild"]);
  });

  it("breaks ties on dispatched+rate by alphabetical namespace", () => {
    const out = selectFlakyNamespaces(
      [
        { namespace: "zeta", usage: usage(5, 10) },
        { namespace: "alpha", usage: usage(5, 10) },
      ],
      5,
    );
    expect(out.map((e) => e.namespace)).toEqual(["alpha", "zeta"]);
  });

  it("caps the result at the given limit", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      namespace: `ns${i}`,
      usage: usage(5, 10),
    }));
    expect(selectFlakyNamespaces(entries, 3)).toHaveLength(3);
  });
});
