// Shared by the search scripts. Node has no built-in .env reader, and adding
// dotenv for six lines isn't worth a dependency.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const env = Object.fromEntries(
  readFileSync(join(root, "src/.env.local"), "utf8")
    .split("\n")
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

// 2026-04-01 is not optional on the serverless tier: index creation on
// 2024-07-01 hangs until the HTTP/2 stream times out, with no error returned.
export const API_VERSION = process.env.API_VERSION || "2026-04-01";
export const INDEX = env.AZURE_SEARCH_INDEX || "erp-docs";

export async function search(path, init = {}) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(
    `${env.AZURE_SEARCH_ENDPOINT}/${path}${separator}api-version=${API_VERSION}`,
    {
      ...init,
      headers: { "Content-Type": "application/json", "api-key": env.AZURE_SEARCH_KEY },
    },
  );
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path}\n  ${response.status} ${await response.text()}`);
  }
  return response;
}
