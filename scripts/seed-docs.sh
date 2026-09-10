#!/usr/bin/env bash
# Downloads Business Central documentation, cleans it, and uploads it to the
# Blob container the search indexer reads from.
#
# Source: github.com/MicrosoftDocs/dynamics365smb-docs (CC-BY-4.0, public).
#
# Selection favours task-oriented pages (finance-*, *-how-to-*, *setup*) and
# excludes design-details-* internals, which describe table structures rather
# than answering the questions a support consultant actually gets asked.
#
# Cleaning removes YAML front matter and INCLUDE directives. Both are
# boilerplate: embedded, they dilute the vector for every chunk, and at query
# time you pay prompt tokens to send them to the model.
#
# Usage:   ./scripts/seed-docs.sh
#          COUNT=150 ./scripts/seed-docs.sh
#          PURGE=0 ./scripts/seed-docs.sh    # keep existing blobs

set -euo pipefail

RG="${RG:-rg-nsk-erp-copilot}"
STORAGE="${STORAGE:-stnskerpcopilot}"
CONTAINER="${CONTAINER:-docs}"
COUNT="${COUNT:-100}"
PURGE="${PURGE:-1}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/data/downloaded"
ENV_FILE="${ROOT}/src/.env.local"

command -v az >/dev/null || { echo "missing: az" >&2; exit 1; }
command -v python3 >/dev/null || { echo "missing: python3" >&2; exit 1; }

rm -rf "${OUT}"
mkdir -p "${OUT}"

COUNT="${COUNT}" OUT="${OUT}" python3 <<'PYTHON'
import json, os, re, sys, urllib.request

REPO = "MicrosoftDocs/dynamics365smb-docs"
DOCDIR = "business-central"
count = int(os.environ["COUNT"])
out = os.environ["OUT"]

def fetch(url):
    with urllib.request.urlopen(url) as response:
        return response.read()

print("Listing documentation files...")
entries = json.loads(fetch(f"https://api.github.com/repos/{REPO}/contents/{DOCDIR}"))
names = [e["name"] for e in entries if e["name"].endswith(".md")]

# Topic relevance: the corpus should be coherent, or retrieval quality is
# untestable.
TOPICS = ("posting", "ledger", "vat", "invoic", "payment", "finance",
          "dimension", "reconcil", "currency", "journal", "tax", "account")

# Task-oriented pages answer real questions. design-details-* documents
# internal table structures and mostly adds noise for this use case.
def wanted(name):
    lower = name.lower()
    if lower.startswith("design-details") or lower.startswith("reservation-entry"):
        return False
    if not any(topic in lower for topic in TOPICS):
        return False
    return (lower.startswith("finance-") or "how-to" in lower
            or "how-" in lower or "setup" in lower or "faqs-" in lower)

candidates = sorted(n for n in names if wanted(n))

# Rank pages whose names look most like the questions users ask, so a COUNT
# cutoff drops the least useful pages rather than everything after "f".
PRIORITY = ("posting-group", "chart-of-accounts", "reconcil", "vat",
            "dimension", "journal", "invoic", "payment", "currency")
def rank(name):
    lower = name.lower()
    for index, term in enumerate(PRIORITY):
        if term in lower:
            return index
    return len(PRIORITY)

picked = sorted(candidates, key=lambda n: (rank(n), n))[:count]
print(f"Selected {len(picked)} of {len(candidates)} candidate pages")

FRONT_MATTER = re.compile(r"\A---\r?\n.*?\r?\n---\r?\n", re.DOTALL)
TITLE = re.compile(r"^title:\s*(.+?)\s*$", re.MULTILINE)
INCLUDE = re.compile(r"\[!INCLUDE\s*\[[^\]]*\](?:\([^)]*\))?\]?")
ALERT = re.compile(r"^>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$", re.MULTILINE)
BLANKS = re.compile(r"\n{3,}")

def clean(text):
    match = FRONT_MATTER.search(text)
    title = None
    if match:
        found = TITLE.search(match.group(0))
        if found:
            title = found.group(1).strip().strip('"')
        text = text[match.end():]
    # Keep the title as a heading: it is genuinely useful content, unlike the
    # ms.date / ms.author metadata around it. Skip it when the page already
    # opens with its own H1, or every chunk carries two near-identical
    # headings.
    if title and not text.lstrip().startswith("# "):
        text = f"# {title}\n\n{text}"
    text = INCLUDE.sub("Business Central", text)
    text = ALERT.sub("", text)
    return BLANKS.sub("\n\n", text).strip() + "\n"

print(f"Downloading and cleaning...")
written = 0
for name in picked:
    try:
        raw = fetch(f"https://raw.githubusercontent.com/{REPO}/main/{DOCDIR}/{name}").decode("utf-8")
    except Exception as error:
        print(f"  skipped {name}: {error}", file=sys.stderr)
        continue
    with open(os.path.join(out, name), "w", encoding="utf-8") as handle:
        handle.write(clean(raw))
    written += 1

print(f"Wrote {written} cleaned files")
PYTHON

SIZE=$(du -sh "${OUT}" | cut -f1)
echo "Corpus size: ${SIZE}"

# Prefer the key in .env.local over calling listKeys: listKeys needs a live ARM
# role, and on a subscription using PIM just-in-time activation that role
# vanishes when the window closes. The cached data-plane key keeps working --
# which is precisely why keys are a weaker posture than managed identity.
ACCOUNT_KEY=""
if [ -f "${ENV_FILE}" ]; then
  ACCOUNT_KEY=$(grep -E '^AZURE_STORAGE_KEY=' "${ENV_FILE}" | cut -d= -f2-)
fi
if [ -z "${ACCOUNT_KEY}" ]; then
  echo "No key in .env.local, asking ARM (needs an active role)..."
  ACCOUNT_KEY=$(az storage account keys list --account-name "${STORAGE}" \
    --resource-group "${RG}" --query "[0].value" --output tsv)
fi

if [ "${PURGE}" = "1" ]; then
  echo "Purging existing blobs..."
  az storage blob delete-batch \
    --account-name "${STORAGE}" \
    --account-key "${ACCOUNT_KEY}" \
    --source "${CONTAINER}" \
    --only-show-errors \
    --output none
fi

echo "Uploading to ${STORAGE}/${CONTAINER}..."
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
echo "Next: node scripts/search-setup.mjs --reset   (rebuild the index)"
