# ERP Support Copilot

Ask a natural-language question about Dynamics 365 Business Central, get a
streamed answer with citations from indexed product documentation, and see what
each answer cost.

Built as a reference project: the point is to demonstrate the Azure patterns a
consultant is expected to know, at a price you can leave running.

## Architecture

```
   Browser ──────────────────────────────────────────┐
                     Azure Container Apps           │
                     Next.js 16, min 0 / max 3      │
        ┌─────────────────┬──────────────────┬───────┤
        ▼                 ▼                  ▼       ▼
   AI Foundry       AI Search           Cosmos DB   App Insights
   ├ chat           (Serverless)        serverless  + Log Analytics
   │ = gpt-5.4-mini ├ vector + BM25     ├ conversations   (1 GB/day cap)
   └ embeddings     ├ semantic ranker   └ usage_events
     = text-emb-3-s └ 518 chunks
        ▲                 │
        │ integrated      ▼
        └─ vectorization  Blob Storage (docs/)
                          100 BC documentation pages
```

100 documentation pages sit in Blob Storage. An AI Search indexer pulls them,
splits them into ~2000-character chunks with 500 of overlap, and embeds each
chunk. Queries run hybrid retrieval (vector + BM25, fused with RRF) reordered by
the semantic ranker; the top 5 chunks go to the chat model, which answers with
`[n]` citations. Each answer reports its token counts and measured search
compute.

Every answer writes a usage event to Cosmos. `/insights` separates what is
**measured** (token counts from the model, compute units from the search
service's response header, latency from Azure's server-side breakdown) from what
is **assumed** (token prices, minutes saved per question, consultant hourly
rate). The assumptions are editable inputs on the page, not hidden constants: a
saving figure whose baseline you cannot see is the first thing a client's finance
team takes apart.

Token prices are unverified — Azure's pricing page currently shows placeholders
for this model family — which is another reason they belong on screen as an
input.

## Key decisions

| Decision | Reason |
|---|---|
| Sweden Central | EU data residency, and every service used here is available in it. Search and Foundry must share a region for key-based connections. |
| AI Search **Serverless Developer** (preview) | The subscription's single Free-tier slot was already in use. Serverless drops compute to zero 10 minutes after an index goes idle, and returns measured cost per query in a response header. |
| API version `2026-04-01` | Not optional: index creation on `2024-07-01` *hangs* on the serverless tier until the HTTP/2 stream times out, with no error returned. |
| Cosmos DB serverless, **not** free tier | A free-tier account is one per subscription, permanent and irreversible; claiming it for a sandbox denies it to a real project. Serverless costs cents here. |
| ghcr.io instead of Container Registry | ACR Basic (~$5/month) was the largest line item in the whole project. A public package needs no registry, no pull secret and no identity. |
| Index definitions in `scripts/`, not Bicep | Indexes, skillsets and indexers are data-plane objects with no ARM representation. Pretending otherwise is a common mistake. |
| API keys | Not a preference — see below. |

## Cost

Roughly **$0–2/month** idle. Container Apps at `minReplicas: 0` falls inside the
monthly free grant; AI Search Serverless bills only while an index is active;
Blob, Cosmos serverless and capped Log Analytics are cents. A grounded answer
costs about **$0.0026** in tokens.

## Prerequisites

Azure CLI 2.90, `azd` 1.33, Bicep 0.46, Node 24+, Docker 28+.

```bash
brew install azure-cli azure-dev gh && az bicep install
```

## Getting started

```bash
az login
./scripts/write-env.sh              # endpoints + keys -> src/.env.local
./scripts/seed-docs.sh              # 100 BC doc pages -> Blob
node scripts/search-setup.mjs       # index, data source, skillset, indexer
node scripts/search-status.mjs "how do I set up posting groups"
cd src && npm install && npm run dev
```

`write-env.sh` prints masked values only, so nothing secret reaches your shell
history. Re-run it any time; never edit `.env.local` by hand.

Re-seeding a *different* corpus needs `node scripts/search-setup.mjs --reset`.
An indexer re-run only adds and updates, so chunks from files you removed would
otherwise stay in the index forever, quietly polluting retrieval.

## Authentication on the deployed app

Container Apps' built-in auth ("easy auth") sits in front of the container as a
proxy: unauthenticated browser requests are redirected to Entra ID, API requests
get a 401, and the application code contains no auth logic at all.

```bash
az ad app create --display-name erp-copilot-auth \
  --web-redirect-uris "https://<app-fqdn>/.auth/login/aad/callback"

# one command, so the secret never appears on screen
SECRET=$(az ad app credential reset --id <app-id> --years 1 --query password -o tsv)
az containerapp secret set -n <app> -g <rg> --secrets aad-client-secret="$SECRET" -o none

az containerapp auth microsoft update -n <app> -g <rg> \
  --client-id <app-id> --client-secret-name aad-client-secret \
  --issuer "https://login.microsoftonline.com/<tenant>/v2.0" --yes
az containerapp auth update -n <app> -g <rg> \
  --unauthenticated-client-action RedirectToLoginPage \
  --redirect-provider azureactivedirectory
```

Two flags worth knowing: `az ad app credential reset` **replaces** every existing
credential unless you pass `--append` — destructive by default, which is useful
when rotating a leaked secret and dangerous otherwise. And `--issuer` and
`--tenant-id` are mutually exclusive on `auth microsoft update`.

Client secrets expire. This one expires in a year, which is the standard way
auth breaks on a date nobody has in their calendar — and the best argument for
managed identity, which has no secret at all.

## Deploying

CI builds the image and publishes it to `ghcr.io` on every push to `main`
(`.github/workflows/build.yml`). The package is public, so Container Apps pulls
it with no registry, no pull secret and no identity.

```bash
./scripts/deploy.sh
```

Deployment is a script rather than a CI job on purpose: deploying from Actions
means giving a federated identity a role on the resource group, and creating
role assignments is not permitted here. The workflow documents the missing
piece rather than committing a job that could never run.

Cold start after an idle period is ~12s, the cost of `minReplicas: 0`. Set it to
1 (~$15/month) before demoing to anyone.

To provision the infrastructure from scratch:

```bash
azd auth login && azd env new dev
azd env set AZURE_LOCATION swedencentral
azd up
```

## Authentication: keys, and why that's a compromise

This was built against a subscription granting **Contributor**, which can read
resource keys but cannot create role assignments
(`Microsoft.Authorization/*/write`). Managed identity needs those, so the app
uses keys from `.env.local`.

The project demonstrated the cost of that by accident. Mid-build the role
expired — a just-in-time activation window closing — removing *all* control-plane
access; the resource group could no longer even be read. **The app kept
working**, because the data-plane keys read earlier were still valid. Revoking
someone's role does nothing about keys they already hold.

That is the argument for managed identity, `disableLocalAuth` and treating key
rotation as real operational work. Switching over is small — swap `apiKey` for
`azureADTokenProvider` and assign `Cognitive Services OpenAI User`,
`Search Index Data Reader` and `Storage Blob Data Reader` — but it needs a
permission this subscription doesn't grant, so it is documented rather than
half-built behind a flag that could never be turned on.

## Repository layout

```
azure.yaml              azd config; Docker build pinned to linux/amd64
infra/main.bicep        subscription-scoped root deployment
infra/modules/          foundry, search, storage, cosmos, monitoring, containerapp
src/app/api/chat/       retrieve -> generate -> stream (newline-delimited JSON)
src/lib/retrieve.ts     hybrid search + semantic reranking
src/lib/cosmos.ts       one usage event per answer
src/app/insights/       cost + ROI page: measured above, assumptions below
scripts/                seeding and data-plane search setup
data/downloaded/        seed corpus (fetched, not committed)
```

## Notes for production

Public endpoints throughout. For a real deployment: private endpoints with
VNet-integrated Container Apps, `publicNetworkAccess: Disabled`, managed
identity with `disableLocalAuth`, AI Search Basic or higher for an SLA and
shared private links, `minReplicas: 1` to avoid cold starts, and an evaluation
suite scoring groundedness over a fixed question set.

## Teardown

```bash
azd down --purge
```

`--purge` matters: soft-deleted Foundry accounts keep their name reserved and
count against quota.

## Build status

- [x] Phase 0 — tooling
- [x] Phase 1 — platform resources (hand-built in Azure, Bicep written to match)
- [x] Phase 2 — Foundry + streaming chat
- [x] Phase 3 — indexing pipeline + hybrid retrieval with citations
- [x] Phase 4 — telemetry + ROI insights page
- [x] Phase 5 — Entra ID auth + CI image builds
- [ ] Phase 6 — verified teardown
- [ ] Phase 7 — agentic retrieval comparison (stretch)
