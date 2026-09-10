// Typed, fail-fast access to configuration.
//
// Reading process.env inline scatters string literals through the codebase and
// fails at request time with an opaque 500 when something is missing. Resolving
// it here means a missing variable is a clear error naming the variable.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Run ./scripts/write-env.sh to regenerate src/.env.local`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const env = {
  // --- Microsoft Foundry ---
  foundryEndpoint: () => required("AZURE_FOUNDRY_ENDPOINT"),
  foundryKey: () => required("AZURE_FOUNDRY_KEY"),
  // Deployment names, not model names — see foundry.ts.
  chatDeployment: () => optional("AZURE_CHAT_DEPLOYMENT", "chat"),
  embeddingDeployment: () => optional("AZURE_EMBEDDING_DEPLOYMENT", "embeddings"),
  openAiApiVersion: () => optional("AZURE_OPENAI_API_VERSION", "2025-04-01-preview"),

  // --- Azure AI Search (Phase 3) ---
  searchEndpoint: () => required("AZURE_SEARCH_ENDPOINT"),
  searchKey: () => required("AZURE_SEARCH_KEY"),
  searchIndex: () => optional("AZURE_SEARCH_INDEX", "erp-docs"),

  // --- Cosmos DB (Phase 4) ---
  cosmosEndpoint: () => required("AZURE_COSMOS_ENDPOINT"),
  cosmosKey: () => required("AZURE_COSMOS_KEY"),
  cosmosDatabase: () => optional("AZURE_COSMOS_DATABASE", "copilot"),

  // True once role assignments exist and keys are switched off.
  useManagedIdentity: () => process.env.USE_MANAGED_IDENTITY === "true",
};
