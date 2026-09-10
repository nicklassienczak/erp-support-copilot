import { AzureOpenAI } from "openai";
import { env } from "./env";

// Client factory for Microsoft Foundry (Azure OpenAI).
//
// Three things differ from the plain OpenAI API and trip most people up:
//
// 1. `apiVersion` is mandatory. Azure versions the REST surface independently
//    of the SDK, so a new model can be unusable until you bump this string.
//    If a request 404s or rejects a parameter you know exists, suspect this
//    first.
//
// 2. You address a *deployment*, not a model. `model: "chat"` refers to the
//    deployment you created in the portal, which happens to point at
//    gpt-5.4-mini. Swapping the underlying model is a portal change; this code
//    doesn't move.
//
// 3. Auth has two modes. Keys today, because Contributor rights can read keys
//    but not create the role assignments managed identity needs. The keyless
//    branch below is the whole change required when that permission arrives.

export function foundryClient(): AzureOpenAI {
  if (env.useManagedIdentity()) {
    // Keyless path. Requires the "Cognitive Services OpenAI User" role on the
    // Foundry account for the app's managed identity (and for your own user
    // when running locally under `az login`).
    //
    // Uncomment once @azure/identity is installed and the role is assigned:
    //
    //   import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
    //   const credential = new DefaultAzureCredential();
    //   const azureADTokenProvider = getBearerTokenProvider(
    //     credential,
    //     "https://cognitiveservices.azure.com/.default",
    //   );
    //   return new AzureOpenAI({
    //     endpoint: env.foundryEndpoint(),
    //     apiVersion: env.openAiApiVersion(),
    //     azureADTokenProvider,
    //   });
    throw new Error(
      "USE_MANAGED_IDENTITY=true but the keyless path is not wired up yet. " +
        "Install @azure/identity and uncomment the block in lib/foundry.ts.",
    );
  }

  return new AzureOpenAI({
    endpoint: env.foundryEndpoint(),
    apiKey: env.foundryKey(),
    apiVersion: env.openAiApiVersion(),
  });
}
