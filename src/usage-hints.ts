import type { NamespaceUsage } from "./learning.js";
import type { DetectedPack } from "./pack-detect.js";

// Inline usage hints for discover() output. Two signals, both
// session-local:
//
//   1. Success count from LearningStore — "you called this N times
//      and it worked." Populated by dispatch's post-call success
//      tracking. Manual `activate` calls don't contribute.
//
//   2. Co-activation peers from PackDetector — "when you loaded X
//      you usually had Y loaded too." Populated by successful proxied
//      tool calls across ≥2 distinct namespaces within a short gap.
//
// Neither persists across process restarts today. That's a known
// limitation — cross-session learning needs backend coordination and
// is tracked separately. Within a single session the signals are
// still useful: they help the LLM re-pick servers it already knows
// work, and they hint at the next server likely needed next.

// Cap on peers per hint. Keeps the discover() line length bounded —
// more than ~3 peers quickly drowns out the rest of the server card.
const MAX_PEERS = 3;
const MIN_SUCCESS_TO_SHOW = 1;

// Flatten detected packs into a per-namespace peer list. Each pack is
// a set of 2-3 namespaces that co-occurred in ≥2 bursts; the map
// entry for namespace N lists every OTHER namespace that appeared in
// any pack containing N.
//
// Output is sorted + deduped so rendering is stable across calls even
// as the underlying pack list's internal order shifts.
export function buildCoUsageMap(packs: DetectedPack[]): Map<string, string[]> {
  const result = new Map<string, Set<string>>();
  for (const pack of packs) {
    for (const ns of pack.namespaces) {
      const bucket = result.get(ns) ?? new Set<string>();
      for (const peer of pack.namespaces) {
        if (peer !== ns) bucket.add(peer);
      }
      result.set(ns, bucket);
    }
  }
  const sorted = new Map<string, string[]>();
  for (const [ns, peers] of result) {
    sorted.set(ns, Array.from(peers).sort());
  }
  return sorted;
}

// Render a one-line "usage:" hint summarizing the two signals. Returns
// null when neither signal has enough evidence — the caller should
// skip the line entirely rather than print "usage: —" or similar.
//
// The string form starts with "usage: " so the LLM can scan past it
// cheaply and the prefix is consistent with other diagnostic lines
// (warn:, known tools:).
export function formatUsageHint(usage: NamespaceUsage | undefined, coUsedWith: string[]): string | null {
  const parts: string[] = [];
  if (usage && usage.succeeded >= MIN_SUCCESS_TO_SHOW) {
    parts.push(`used ${usage.succeeded}x this session`);
  }
  if (coUsedWith.length > 0) {
    const shown = coUsedWith.slice(0, MAX_PEERS);
    const more = coUsedWith.length - shown.length;
    const names = shown.map((n) => `"${n}"`).join(", ");
    const tail = more > 0 ? ` +${more} more` : "";
    parts.push(`often loaded with ${names}${tail}`);
  }
  if (parts.length === 0) return null;
  return `usage: ${parts.join("; ")}`;
}
