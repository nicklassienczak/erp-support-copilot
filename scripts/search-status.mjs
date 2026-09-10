// Reports indexer progress and index contents.
//
// Usage: node scripts/search-status.mjs
//        node scripts/search-status.mjs "posting groups"   # also run a query

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const env = Object.fromEntries(
  readFileSync(join(root, "src/.env.local"), "utf8")
    .split("\n")
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const API_VERSION = process.env.API_VERSION || "2024-07-01";
const INDEX = env.AZURE_SEARCH_INDEX || "erp-docs";

async function api(path, init = {}) {
  const response = await fetch(
    `${env.AZURE_SEARCH_ENDPOINT}/${path}${path.includes("?") ? "&" : "?"}api-version=${API_VERSION}`,
    {
      ...init,
      headers: { "Content-Type": "application/json", "api-key": env.AZURE_SEARCH_KEY },
    },
  );
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

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
