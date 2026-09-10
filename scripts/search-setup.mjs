// Creates the four Azure AI Search objects that make up the indexing pipeline:
//
//   data source -> where the documents live (your blob container)
//   skillset    -> what happens to each document (split into chunks, embed each)
//   index       -> the schema the chunks land in (text + vectors + semantic config)
//   indexer     -> the job that ties the three together and runs on a schedule
//
// These are DATA-PLANE objects. They have no ARM representation, which is why
// they are not in infra/*.bicep and why this script exists. It authenticates
// with the search admin key, so it needs no Azure role at all.
//
// Idempotent: every call is a PUT, so re-running updates in place.
//
// Usage: node scripts/search-setup.mjs
//        API_VERSION=2026-04-01 node scripts/search-setup.mjs

import { env, API_VERSION, INDEX } from "./lib.mjs";

// --- config ---------------------------------------------------------------

const SEARCH_ENDPOINT = env.AZURE_SEARCH_ENDPOINT;
const SEARCH_KEY = env.AZURE_SEARCH_KEY;
const DATASOURCE = `${INDEX}-datasource`;
const SKILLSET = `${INDEX}-skillset`;
const INDEXER = `${INDEX}-indexer`;

// The embedding skill and the query-time vectorizer both want the Azure OpenAI
// style hostname, not the multi-service cognitiveservices.azure.com one.
const foundryHost = new URL(env.AZURE_FOUNDRY_ENDPOINT).hostname.split(".")[0];
const OPENAI_URI = `https://${foundryHost}.openai.azure.com`;

const EMBEDDING_DEPLOYMENT = env.AZURE_EMBEDDING_DEPLOYMENT || "embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;

const STORAGE_CONNECTION =
  `DefaultEndpointsProtocol=https;AccountName=${env.AZURE_STORAGE_ACCOUNT};` +
  `AccountKey=${env.AZURE_STORAGE_KEY};EndpointSuffix=core.windows.net`;

// --- REST helper ----------------------------------------------------------

async function del(path) {
  const url = `${SEARCH_ENDPOINT}/${path}?api-version=${API_VERSION}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: { "api-key": SEARCH_KEY },
  });
  // 404 is fine: nothing to delete on a first run.
  if (!response.ok && response.status !== 404) {
    throw new Error(`DELETE ${path}\n  ${response.status} ${await response.text()}`);
  }
  console.log(`  deleted  ${path.split("/").pop()}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Index creation right after a delete intermittently returns a 500 with an
// internal HttpClient.Timeout: deletion is asynchronous, so the name can still
// be held when the create arrives. Retrying with backoff is the documented
// answer, not a workaround.
async function put(path, body, attempts = 4) {
  const url = `${SEARCH_ENDPOINT}/${path}?api-version=${API_VERSION}`;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "api-key": SEARCH_KEY,
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      console.log(`  ok  ${path.split("/").pop()}`);
      return;
    }

    const text = await response.text();
    const transient = response.status >= 500 || response.status === 429;

    if (!transient || attempt === attempts) {
      throw new Error(`${path}\n  ${response.status} ${text}`);
    }

    const backoff = attempt * 5000;
    console.log(`  retry ${attempt}/${attempts - 1} in ${backoff / 1000}s (${response.status})`);
    await sleep(backoff);
  }
}

// --- 1. index -------------------------------------------------------------
// chunk_id is the key and is generated automatically, one per chunk, by the
// skillset's index projection. parent_id links a chunk back to its source file.

const index = {
  name: INDEX,
  fields: [
    {
      name: "chunk_id",
      type: "Edm.String",
      key: true,
      searchable: true,
      filterable: true,
      sortable: true,
      // The keyword analyzer keeps the generated id as a single token instead
      // of splitting it on punctuation.
      analyzer: "keyword",
    },
    { name: "parent_id", type: "Edm.String", filterable: true },
    { name: "title", type: "Edm.String", searchable: true, filterable: true },
    { name: "chunk", type: "Edm.String", searchable: true, filterable: false },
    {
      name: "text_vector",
      type: "Collection(Edm.Single)",
      searchable: true,
      retrievable: false,
      // stored=false discards the raw vector after the index is built. It is
      // still searchable; it just isn't returned. On a consumption tier where
      // vector size drives both storage and compute cost, this is free money.
      stored: false,
      dimensions: DIMENSIONS,
      vectorSearchProfile: "erp-vector-profile",
    },
  ],
  vectorSearch: {
    algorithms: [{ name: "erp-hnsw", kind: "hnsw" }],
    profiles: [
      {
        name: "erp-vector-profile",
        algorithm: "erp-hnsw",
        // Attaching a vectorizer means the service embeds the query text
        // itself. Without it, the app would have to call the embedding model
        // separately on every search.
        vectorizer: "erp-vectorizer",
      },
    ],
    vectorizers: [
      {
        name: "erp-vectorizer",
        kind: "azureOpenAI",
        azureOpenAIParameters: {
          resourceUri: OPENAI_URI,
          deploymentId: EMBEDDING_DEPLOYMENT,
          modelName: EMBEDDING_MODEL,
          apiKey: env.AZURE_FOUNDRY_KEY,
        },
      },
    ],
  },
  semantic: {
    configurations: [
      {
        name: "erp-semantic",
        prioritizedFields: {
          titleField: { fieldName: "title" },
          prioritizedContentFields: [{ fieldName: "chunk" }],
        },
      },
    ],
  },
};

// --- 2. data source -------------------------------------------------------

const dataSource = {
  name: DATASOURCE,
  type: "azureblob",
  // Key-based, because granting the search service's managed identity
  // Storage Blob Data Reader needs role-assignment rights we don't have.
  credentials: { connectionString: STORAGE_CONNECTION },
  container: { name: env.AZURE_STORAGE_CONTAINER || "docs" },
};

// --- 3. skillset ----------------------------------------------------------

const skillset = {
  name: SKILLSET,
  description: "Split Business Central docs into chunks and embed each chunk",
  skills: [
    {
      "@odata.type": "#Microsoft.Skills.Text.SplitSkill",
      name: "split",
      description: "Chunk the document text",
      context: "/document",
      textSplitMode: "pages",
      // ~2000 characters with 500 of overlap. Overlap matters: a procedure
      // split mid-sentence loses the context that makes it retrievable.
      maximumPageLength: 2000,
      pageOverlapLength: 500,
      inputs: [{ name: "text", source: "/document/content" }],
      outputs: [{ name: "textItems", targetName: "pages" }],
    },
    {
      "@odata.type": "#Microsoft.Skills.Text.AzureOpenAIEmbeddingSkill",
      name: "embed",
      description: "Embed each chunk",
      // The /* is the important part: this skill runs once per chunk, not once
      // per document.
      context: "/document/pages/*",
      resourceUri: OPENAI_URI,
      deploymentId: EMBEDDING_DEPLOYMENT,
      modelName: EMBEDDING_MODEL,
      apiKey: env.AZURE_FOUNDRY_KEY,
      dimensions: DIMENSIONS,
      inputs: [{ name: "text", source: "/document/pages/*" }],
      outputs: [{ name: "embedding", targetName: "text_vector" }],
    },
  ],
  // Index projections fan one source document out into many index documents,
  // one per chunk. Without this you would get one index entry per file and
  // retrieval would return whole documents instead of relevant passages.
  indexProjections: {
    selectors: [
      {
        targetIndexName: INDEX,
        parentKeyFieldName: "parent_id",
        sourceContext: "/document/pages/*",
        mappings: [
          { name: "chunk", source: "/document/pages/*" },
          { name: "text_vector", source: "/document/pages/*/text_vector" },
          { name: "title", source: "/document/metadata_storage_name" },
        ],
      },
    ],
    parameters: {
      // The parent documents carry no useful content of their own once chunked.
      projectionMode: "skipIndexingParentDocuments",
    },
  },
};

// --- 4. indexer -----------------------------------------------------------

const indexer = {
  name: INDEXER,
  dataSourceName: DATASOURCE,
  skillsetName: SKILLSET,
  targetIndexName: INDEX,
  parameters: {
    configuration: {
      dataToExtract: "contentAndMetadata",
      parsingMode: "default",
    },
  },
  fieldMappings: [],
  outputFieldMappings: [],
};

// --- run ------------------------------------------------------------------

console.log(`Search service: ${SEARCH_ENDPOINT}`);
console.log(`API version:    ${API_VERSION}\n`);

// --reset drops the index and indexer before recreating them.
//
// Needed whenever the corpus changes, because an indexer re-run only adds and
// updates: chunks belonging to files you removed from the container stay in the
// index forever, quietly polluting retrieval. Deleting the index is the honest
// way to guarantee it matches the source.
if (process.argv.includes("--reset")) {
  console.log("Resetting:");
  await del(`indexers/${INDEXER}`);
  await del(`indexes/${INDEX}`);
  console.log();
}

// Order matters: the index must exist before the skillset that projects into
// it, and both before the indexer that references them.
await put(`indexes/${INDEX}`, index);
await put(`datasources/${DATASOURCE}`, dataSource);
await put(`skillsets/${SKILLSET}`, skillset);
await put(`indexers/${INDEXER}`, indexer);

console.log(`
Created. The indexer starts automatically on creation.
Check progress with:

  node scripts/search-status.mjs
`);
