import { CosmosClient } from "@azure/cosmos";
import { env } from "./env";

// One usage event per answer, for the /insights page.
//
// Partitioned by /day: the dashboard aggregates by date, so a day's events sit
// in one partition. The trade-off is that all writes hit today's partition —
// irrelevant at demo volume, worth revisiting at real scale.

export type UsageEvent = {
  id: string;
  /** Partition key: YYYY-MM-DD. */
  day: string;
  timestamp: string;
  question: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  /** Measured search cost from the x-ms-azs-compute-units-consumed header. */
  searchComputeUnits?: number;
  searchLatencyMs: number;
  ttftMs?: number;
  totalLatencyMs?: number;
  sources: string[];
};

let cached: CosmosClient | undefined;

function container() {
  // Reused across requests: a new CosmosClient per request leaks sockets and
  // pays TLS setup every time.
  cached ??= new CosmosClient({
    endpoint: env.cosmosEndpoint(),
    key: env.cosmosKey(),
  });
  return cached.database(env.cosmosDatabase()).container("usage_events");
}

export async function recordUsage(event: Omit<UsageEvent, "id" | "day" | "timestamp">) {
  const now = new Date();
  const doc: UsageEvent = {
    ...event,
    id: crypto.randomUUID(),
    day: now.toISOString().slice(0, 10),
    timestamp: now.toISOString(),
  };
  await container().items.create(doc);
  return doc;
}

/** Most recent events, newest first. */
export async function listUsage(limit = 200): Promise<UsageEvent[]> {
  const { resources } = await container()
    .items.query<UsageEvent>({
      query: "SELECT * FROM c ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit",
      parameters: [{ name: "@limit", value: limit }],
    })
    .fetchAll();
  return resources;
}
