import { env } from "./env";

// Retrieval against Azure AI Search.
//
// Two retrieval modes are planned. This file implements the first:
//
//   hybrid  - vector + keyword (BM25) in one request, fused with Reciprocal
//             Rank Fusion, then reordered by the semantic ranker.
//   agentic - the search service plans sub-queries with an LLM (Phase 7).
//
// Both satisfy the same `retrieve()` contract so the app can switch modes
// without the caller knowing which is in use.

export type Passage = {
  title: string;
  chunk: string;
  score: number;
};

export type RetrievalResult = {
  passages: Passage[];
  /** Consumption-tier compute cost of this query, from Azure's response header. */
  computeUnits?: number;
  latencyMs: number;
};

const API_VERSION = "2024-07-01";

export async function retrieveHybrid(query: string, top = 5): Promise<RetrievalResult> {
  const started = Date.now();

  const response = await fetch(
    `${env.searchEndpoint()}/indexes/${env.searchIndex()}/docs/search?api-version=${API_VERSION}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": env.searchKey(),
      },
      body: JSON.stringify({
        // Keyword half of the hybrid query.
        search: query,
        // Vector half. `kind: "text"` means the service embeds this text with
        // the vectorizer configured on the index, so we never call the
        // embedding model ourselves.
        vectorQueries: [{ kind: "text", text: query, fields: "text_vector", k: top * 2 }],
        // Semantic reranking reorders the fused results with a language model.
        // It is the single biggest relevance win available, and on this tier
        // it bills on a separate meter from compute.
        queryType: "semantic",
        semanticConfiguration: "erp-semantic",
        // Only ask for what is used. Every returned field costs serialization
        // compute on a consumption tier.
        select: "title,chunk",
        top,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`search failed: ${response.status} ${await response.text()}`);
  }

  // Azure returns the consumption cost of the request in a header. This is
  // measured, not estimated — it feeds the cost panel directly.
  const computeUnits = Number(response.headers.get("x-ms-azs-compute-units-consumed"));

  const body = (await response.json()) as {
    value: Array<{
      title: string;
      chunk: string;
      "@search.score": number;
      "@search.rerankerScore"?: number;
    }>;
  };

  return {
    passages: body.value.map((hit) => ({
      title: hit.title,
      chunk: hit.chunk,
      // Prefer the reranker score: it is a 0-4 relevance judgement, whereas
      // @search.score is an unbounded RRF fusion score that means little on
      // its own.
      score: hit["@search.rerankerScore"] ?? hit["@search.score"],
    })),
    computeUnits: Number.isFinite(computeUnits) ? computeUnits : undefined,
    latencyMs: Date.now() - started,
  };
}

/** Formats passages as numbered sources the model can cite as [1], [2]. */
export function asContext(passages: Passage[]): string {
  return passages
    .map((passage, index) => `[${index + 1}] ${passage.title}\n${passage.chunk}`)
    .join("\n\n---\n\n");
}
