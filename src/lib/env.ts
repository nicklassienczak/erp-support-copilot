// Configuration, read once per call site.
//
// The only thing worth wrapping is the missing-variable case: without it a
// typo in .env.local surfaces as an opaque 401 from Azure rather than a
// message naming the variable.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Run ./scripts/write-env.sh to regenerate src/.env.local`,
    );
  }
  return value;
}

export const env = {
  foundryEndpoint: () => required("AZURE_FOUNDRY_ENDPOINT"),
  foundryKey: () => required("AZURE_FOUNDRY_KEY"),
  // Deployment name, not model name: the model is chosen in the portal.
  chatDeployment: () => process.env.AZURE_CHAT_DEPLOYMENT || "chat",
  openAiApiVersion: () => process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview",

  searchEndpoint: () => required("AZURE_SEARCH_ENDPOINT"),
  searchKey: () => required("AZURE_SEARCH_KEY"),
  searchIndex: () => process.env.AZURE_SEARCH_INDEX || "erp-docs",
};
