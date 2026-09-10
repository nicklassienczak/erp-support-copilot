# ERP Support Copilot

A small, cheap, production-shaped AI application on Azure: ask a natural-language
question about Dynamics 365 / Business Central, get a streamed answer with
citations from indexed product documentation, and see what each answer cost
against what the manual alternative would have cost.

Built as a reference project — the goal is to demonstrate the platform patterns
a consultant is expected to know, at a price you can leave running.

## Architecture

```
                       Entra ID (easy auth, tenant-only)
                                 │
   Browser ──────────────────────▼─────────────────────────────┐
                        Azure Container Apps                   │
                        Next.js 16 (standalone, 1 container)   │
                        min 0 / max 3 replicas                 │
                          │  user-assigned managed identity    │
        ┌─────────────────┼──────────────────┬─────────────────┤
        ▼                 ▼                  ▼                 ▼
  AI Foundry        AI Search (Free)   Cosmos DB          App Insights
  ├ gpt-5.4-mini    ├ vector + BM25    serverless         + OTel traces
  └ text-emb-3-sm   ├ semantic ranker  ├ conversations    (model calls,
        ▲           └ knowledge base   └ usage_events      tokens, cost)
        │                  │
        │  integrated      ▼
        └── vectorization  Blob Storage (docs/)
            (Search MI)
```

Documents land in Blob Storage. An AI Search indexer pulls them, splits them
into chunks and embeds each chunk (integrated vectorization, authenticated with
Search's own managed identity — no keys). Queries run hybrid retrieval (vector +
BM25) with the semantic ranker, and the top chunks are passed to the chat model.
Every answer emits a usage event to Cosmos DB and a trace span to Application
Insights.

## Key decisions

| Decision | Reason |
|---|---|
| Sweden Central | Free-tier AI Search there includes the semantic ranker *and* agentic retrieval, plus EU data residency. |
| AI Search Free tier | $0 against ~$75/month for Basic. 50 MB / 3 indexes is ample for a demo; `searchSku` flips to `basic` when it isn't. |
| Single Next.js container | UI, API and streaming in one deployable, scaled to zero when idle. |
| User-assigned managed identity | No keys anywhere. The identity exists before the app, so all role assignments land in one deployment. |
| Cosmos DB serverless | Chat history and usage events for cents, with no idle charge. |
| azd + modular Bicep | `azd up` is the expected workflow; the modules are the reviewable artifact. |

## Cost

Roughly **$6–8/month** idle, almost all of it Container Registry Basic (~$5).
Container Apps at `minReplicas: 0` and AI Search Free are $0; Blob, Cosmos
serverless and capped Log Analytics ingestion are cents. Token spend depends on
use — a demo session is well under $1.

## Prerequisites

| Tool | Version used |
|---|---|
| Azure CLI | 2.90.0 |
| Azure Developer CLI (`azd`) | 1.33.0 |
| Bicep CLI | 0.46.1 |
| Node.js | 24+ (26 locally) |
| Docker | 28+ |

```bash
brew install azure-cli azure-dev gh
az bicep install
```

## Getting started

```bash
az login
./scripts/write-env.sh        # fetches endpoints + keys into src/.env.local
cd src && npm install && npm run dev
```

`write-env.sh` reads the resource metadata from Azure and writes a gitignored
`src/.env.local`, printing only masked values so nothing secret reaches your
shell history. Re-run it any time; never edit the file by hand.

To provision the infrastructure from scratch in a new environment:

```bash
azd auth login
azd env new dev
azd env set AZURE_LOCATION swedencentral
azd up
```

## Authentication: keys today, managed identity tomorrow

The target subscription grants **Contributor**, which permits reading resource
keys but *not* creating role assignments (`Microsoft.Authorization/*/write`).
Keyless managed-identity auth therefore can't be deployed as written, so the app
authenticates with keys held in `.env.local` locally and Container Apps secrets
in Azure.

The managed-identity design is still in the repo, behind the
`useManagedIdentity` parameter (default `false`). When the role-assignment
permission is granted, flipping it switches every service to Entra ID auth and
`disableLocalAuth` turns keys off. The flag documents the constraint rather than
hiding it.

## Repository layout

```
azure.yaml            azd service definition (Docker build pinned to linux/amd64)
infra/
  main.bicep          subscription-scoped root deployment
  modules/            one module per concern; rbac.bicep holds every role assignment
src/                  Next.js 16 application (UI + API routes)
scripts/              data-plane setup: search index, skillset, indexer, seeding
data/                 seed corpus
```

**Why the search index is not in Bicep:** the search *service* is an ARM
resource and lives in `infra/`. The index, data source, skillset and indexer are
data-plane definitions with no ARM representation, so they are applied by
`scripts/search-setup.ts` over REST as an `azd` postprovision hook.

## Teardown

```bash
azd down --purge
```

`--purge` matters: soft-deleted Foundry accounts otherwise keep their name
reserved and count against quota.

## Build status

- [x] Phase 0 — tooling
- [x] Phase 1 — platform resources created (hand-built in Azure; Bicep written to match)
- [x] Phase 2 — Foundry + streaming chat
- [ ] Phase 3 — indexing pipeline + hybrid retrieval
- [ ] Phase 4 — telemetry + ROI insights
- [ ] Phase 5 — Entra ID auth + GitHub Actions OIDC
- [ ] Phase 6 — docs + verified teardown
- [ ] Phase 7 — agentic retrieval comparison (stretch)
