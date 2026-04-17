import { request } from "undici";
import { log } from "./logger.js";

// Stage-2 rerank client. BM25 narrows the field locally; this service
// call asks mcp.hosting to embed the intent and cosine-sort the
// shortlist against stored server embeddings. Fails silently by
// returning null — callers stay with the BM25 order when the backend
// doesn't have a Voyage key, when the network hiccups, or when the
// request times out. Rerank is an optimization, not a requirement.

let apiUrl = "";
let token = "";

const RERANK_TIMEOUT_MS = 2_000;

export function initRerank(url: string, tok: string): void {
  apiUrl = url;
  token = tok;
}

export interface RerankResult {
  id: string;
  score: number;
}

// Ask the backend to rerank the candidate server ids by semantic
// similarity to the intent. Returns null when rerank is unavailable
// (key absent, candidates not yet embedded, timeout, any non-2xx) so
// the caller can stick with BM25 without ceremony.
//
// `candidateIds` is optional. When omitted, the backend runs a top-K
// pgvector search over the caller's entire library (personal + team)
// — used by discover to surface semantically-relevant servers the
// user hasn't activated yet, without BM25 having to shortlist first.
export async function rerank(intent: string, candidateIds?: string[], limit?: number): Promise<RerankResult[] | null> {
  if (!apiUrl || !token) return null;
  if (!intent?.trim()) return null;
  // Treat "empty array provided" as "caller has no BM25 shortlist to
  // narrow against" — same fallback as no-array. Only skip the call
  // when the caller explicitly opted into shortlist mode with zero ids.
  if (candidateIds !== undefined && candidateIds.length === 0) return null;

  const payload: { intent: string; candidateIds?: string[]; limit?: number } = { intent: intent.trim() };
  if (candidateIds && candidateIds.length > 0) payload.candidateIds = candidateIds;
  if (typeof limit === "number" && limit > 0) payload.limit = limit;

  try {
    const res = await request(`${apiUrl.replace(/\/$/, "")}/api/connect/rerank`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      headersTimeout: RERANK_TIMEOUT_MS,
      bodyTimeout: RERANK_TIMEOUT_MS,
    });

    // 503 = "rerank not configured on this deployment" — expected on
    // hosted deploys without VOYAGE_API_KEY and on self-host without a
    // key. Treat it as silent fallback, not an error to log.
    if (res.statusCode === 503) {
      await res.body.text().catch(() => {});
      return null;
    }

    if (res.statusCode !== 200) {
      await res.body.text().catch(() => {});
      log("warn", "Rerank request failed", { status: res.statusCode });
      return null;
    }

    const body = (await res.body.json()) as {
      results?: RerankResult[];
      reason?: string;
    };

    if (!body || !Array.isArray(body.results)) return null;
    // Empty results list just means "no vectors available yet" — same
    // semantics as 503 for the caller.
    if (body.results.length === 0) return null;
    return body.results;
  } catch (err: any) {
    // Network / timeout / JSON parse — same fallback posture.
    log("debug", "Rerank request errored", { error: err?.message });
    return null;
  }
}
