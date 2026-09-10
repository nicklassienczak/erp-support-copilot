// Reports indexer progress and index contents.
//
// Usage: node scripts/search-status.mjs
//        node scripts/search-status.mjs "posting groups"   # also run a query

import { INDEX, search } from "./lib.mjs";

const api = async (path, init) => (await search(path, init)).json();

const status = await api(`indexers/${INDEX}-indexer/status`);
const last = status.lastResult ?? {};

console.log(`indexer:   ${status.status}`);
console.log(`last run:  ${last.status ?? "n/a"}`);
console.log(`items:     ${last.itemsProcessed ?? 0} processed, ${last.itemsFailed ?? 0} failed`);
if (last.startTime) console.log(`started:   ${last.startTime}`);
if (last.errorMessage) console.log(`error:     ${last.errorMessage}`);
for (const warning of (last.warnings ?? []).slice(0, 3)) {
  console.log(`warning:   ${warning.message}`);
}
for (const error of (last.errors ?? []).slice(0, 5)) {
  console.log(`failed:    ${error.key ?? ""} ${error.errorMessage}`);
}

const count = await api(`indexes/${INDEX}/docs/$count`).catch(() => null);
console.log(`documents: ${count ?? "?"} chunks in index`);

// Optional smoke test: hybrid query (vector + keyword) with semantic reranking.
const query = process.argv[2];
if (query) {
  console.log(`\nquery: "${query}"`);
  const results = await api(`indexes/${INDEX}/docs/search`, {
    method: "POST",
    body: JSON.stringify({
      search: query,
      // The vectorizer on the index embeds this text server-side, so the app
      // never calls the embedding model itself.
      vectorQueries: [{ kind: "text", text: query, fields: "text_vector", k: 5 }],
      queryType: "semantic",
      semanticConfiguration: "erp-semantic",
      select: "title,chunk",
      top: 3,
    }),
  });

  for (const [i, hit] of (results.value ?? []).entries()) {
    const score = hit["@search.rerankerScore"] ?? hit["@search.score"];
    console.log(`\n[${i + 1}] ${hit.title}  (score ${Number(score).toFixed(2)})`);
    console.log(`    ${hit.chunk.replace(/\s+/g, " ").slice(0, 200)}...`);
  }
}
