#!/usr/bin/env bash
# Downloads a sample of public Business Central documentation and uploads it to
# the Blob container the search indexer reads from.
#
# Source: github.com/MicrosoftDocs/dynamics365smb-docs (CC-BY-4.0, public).
# Only finance-related pages are taken, so the corpus is coherent enough that
# retrieval quality is meaningful rather than random.
#
# Usage:   ./scripts/seed-docs.sh
#          COUNT=80 ./scripts/seed-docs.sh

set -euo pipefail

RG="${RG:-rg-nsk-erp-copilot}"
STORAGE="${STORAGE:-stnskerpcopilot}"
CONTAINER="${CONTAINER:-docs}"
COUNT="${COUNT:-40}"

REPO="MicrosoftDocs/dynamics365smb-docs"
DOCDIR="business-central"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/data/downloaded"

command -v az >/dev/null || { echo "missing: az" >&2; exit 1; }
command -v python3 >/dev/null || { echo "missing: python3" >&2; exit 1; }

mkdir -p "${OUT}"

echo "Listing documentation files..."
curl -fsS "https://api.github.com/repos/${REPO}/contents/${DOCDIR}" \
  | COUNT="${COUNT}" python3 -c '
import sys, json, os
count = int(os.environ["COUNT"])
entries = json.load(sys.stdin)
names = [e["name"] for e in entries if e["name"].endswith(".md")]
keywords = ("posting", "ledger", "vat", "invoic", "payment", "finance",
            "account", "dimension", "reconcil", "currency")
picked = [n for n in names if any(k in n.lower() for k in keywords)]
print("\n".join(sorted(picked)[:count]))
' > "${OUT}/.filelist"

TOTAL=$(wc -l < "${OUT}/.filelist" | tr -d ' ')
echo "Downloading ${TOTAL} files..."

while IFS= read -r name; do
  [ -n "${name}" ] || continue
  curl -fsSL -o "${OUT}/${name}" \
    "https://raw.githubusercontent.com/${REPO}/main/${DOCDIR}/${name}" \
    || echo "  skipped ${name}" >&2
done < "${OUT}/.filelist"

DOWNLOADED=$(find "${OUT}" -name '*.md' | wc -l | tr -d ' ')
SIZE=$(du -sh "${OUT}" | cut -f1)
echo "Downloaded ${DOWNLOADED} files (${SIZE})"

echo "Uploading to ${STORAGE}/${CONTAINER}..."

# upload-batch does not auto-resolve the account key the way `container create`
# does, so it has to be supplied explicitly.
#
# Prefer the key already in .env.local over calling listKeys. That is not just
# convenience: listKeys needs a live ARM role, and on a subscription using PIM
# just-in-time activation that role disappears when the activation window
# closes. The cached data-plane key keeps working regardless — which is the
# whole reason keys are a weaker security posture than managed identity.
ENV_FILE="${ROOT}/src/.env.local"
ACCOUNT_KEY=""

if [ -f "${ENV_FILE}" ]; then
  ACCOUNT_KEY=$(grep -E '^AZURE_STORAGE_KEY=' "${ENV_FILE}" | cut -d= -f2-)
fi

if [ -z "${ACCOUNT_KEY}" ]; then
  echo "No key in .env.local, asking ARM (needs an active role)..."
  ACCOUNT_KEY=$(az storage account keys list \
    --account-name "${STORAGE}" \
    --resource-group "${RG}" \
    --query "[0].value" \
    --output tsv)
fi

az storage blob upload-batch \
  --account-name "${STORAGE}" \
  --account-key "${ACCOUNT_KEY}" \
  --destination "${CONTAINER}" \
  --source "${OUT}" \
  --pattern "*.md" \
  --overwrite \
  --only-show-errors \
  --output none

BLOBS=$(az storage blob list \
  --account-name "${STORAGE}" \
  --account-key "${ACCOUNT_KEY}" \
  --container-name "${CONTAINER}" \
  --query "length(@)" \
  --output tsv)

echo
echo "Done. ${BLOBS} blobs in ${STORAGE}/${CONTAINER}"
