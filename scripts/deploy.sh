#!/usr/bin/env bash
# Deploys the image built by CI to Azure Container Apps.
#
# This is a script rather than a CI job because deploying from GitHub Actions
# needs a federated identity with a role on the resource group, and creating
# role assignments is not permitted on the target subscription. See
# .github/workflows/build.yml for the missing piece.
#
# Secrets are read from .env.local and passed straight into Container Apps
# secrets. They are never echoed.
#
# Usage: ./scripts/deploy.sh

set -euo pipefail

RG="${RG:-rg-nsk-erp-copilot}"
LOCATION="${LOCATION:-swedencentral}"
ENVIRONMENT="${ENVIRONMENT:-cae-erp-copilot}"
APP="${APP:-ca-erp-copilot}"
WORKSPACE="${WORKSPACE:-log-nsk-erp-copilot}"
IMAGE="${IMAGE:-ghcr.io/nicklassienczak/erp-support-copilot:latest}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/src/.env.local"

[ -f "${ENV_FILE}" ] || { echo "missing ${ENV_FILE}; run ./scripts/write-env.sh" >&2; exit 1; }

get() { grep -E "^$1=" "${ENV_FILE}" | cut -d= -f2-; }

FOUNDRY_ENDPOINT=$(get AZURE_FOUNDRY_ENDPOINT)
FOUNDRY_KEY=$(get AZURE_FOUNDRY_KEY)
SEARCH_ENDPOINT=$(get AZURE_SEARCH_ENDPOINT)
SEARCH_KEY=$(get AZURE_SEARCH_KEY)
COSMOS_ENDPOINT=$(get AZURE_COSMOS_ENDPOINT)
COSMOS_KEY=$(get AZURE_COSMOS_KEY)
APPI_CONNECTION=$(get APPLICATIONINSIGHTS_CONNECTION_STRING)

az extension add --name containerapp --upgrade --only-show-errors >/dev/null 2>&1 || true

if ! az containerapp env show -n "${ENVIRONMENT}" -g "${RG}" --only-show-errors >/dev/null 2>&1; then
  echo "Creating Container Apps environment (a few minutes)..."
  WORKSPACE_ID=$(az monitor log-analytics workspace show -g "${RG}" -n "${WORKSPACE}" --query customerId -o tsv)
  WORKSPACE_KEY=$(az monitor log-analytics workspace get-shared-keys -g "${RG}" -n "${WORKSPACE}" --query primarySharedKey -o tsv)
  az containerapp env create \
    --name "${ENVIRONMENT}" \
    --resource-group "${RG}" \
    --location "${LOCATION}" \
    --logs-destination log-analytics \
    --logs-workspace-id "${WORKSPACE_ID}" \
    --logs-workspace-key "${WORKSPACE_KEY}" \
    --only-show-errors --output none
fi

# Secrets first, then env vars that reference them. Values reaching the app as
# secretref are stored encrypted and are not readable back from the API.
SECRETS=(
  "foundry-key=${FOUNDRY_KEY}"
  "search-key=${SEARCH_KEY}"
  "cosmos-key=${COSMOS_KEY}"
  "appi-connection=${APPI_CONNECTION}"
)

ENVVARS=(
  "AZURE_FOUNDRY_ENDPOINT=${FOUNDRY_ENDPOINT}"
  "AZURE_FOUNDRY_KEY=secretref:foundry-key"
  "AZURE_CHAT_DEPLOYMENT=chat"
  "AZURE_EMBEDDING_DEPLOYMENT=embeddings"
  "AZURE_OPENAI_API_VERSION=2025-04-01-preview"
  "AZURE_SEARCH_ENDPOINT=${SEARCH_ENDPOINT}"
  "AZURE_SEARCH_KEY=secretref:search-key"
  "AZURE_SEARCH_INDEX=erp-docs"
  "AZURE_COSMOS_ENDPOINT=${COSMOS_ENDPOINT}"
  "AZURE_COSMOS_KEY=secretref:cosmos-key"
  "AZURE_COSMOS_DATABASE=copilot"
  "APPLICATIONINSIGHTS_CONNECTION_STRING=secretref:appi-connection"
)

if az containerapp show -n "${APP}" -g "${RG}" --only-show-errors >/dev/null 2>&1; then
  echo "Updating ${APP}..."
  az containerapp secret set -n "${APP}" -g "${RG}" --secrets "${SECRETS[@]}" --only-show-errors --output none
  az containerapp update -n "${APP}" -g "${RG}" \
    --image "${IMAGE}" \
    --set-env-vars "${ENVVARS[@]}" \
    --only-show-errors --output none
else
  echo "Creating ${APP}..."
  az containerapp create \
    --name "${APP}" \
    --resource-group "${RG}" \
    --environment "${ENVIRONMENT}" \
    --image "${IMAGE}" \
    --target-port 3000 \
    --ingress external \
    --min-replicas 0 \
    --max-replicas 3 \
    --cpu 0.5 --memory 1Gi \
    --secrets "${SECRETS[@]}" \
    --env-vars "${ENVVARS[@]}" \
    --tags owner=nsk project=erp-copilot \
    --only-show-errors --output none
fi

FQDN=$(az containerapp show -n "${APP}" -g "${RG}" --query properties.configuration.ingress.fqdn -o tsv)
echo
echo "Deployed: https://${FQDN}"
