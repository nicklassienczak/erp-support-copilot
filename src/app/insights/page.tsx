import Link from "next/link";
import { listUsage, type UsageEvent } from "@/lib/cosmos";
import { Assumptions } from "./assumptions";

// Cost and ROI for the answers this app has given.
//
// The page is split deliberately: everything above the fold is MEASURED, read
// from the API responses themselves (token counts from the model, compute units
// from the search service's response header, latency from Azure's own
// server-side breakdown). Everything derived from an assumption lives in the
// panel below, with the assumption visible and editable next to it.
//
// No chart here on purpose: these are headline magnitudes, not a trend. A
// sparkline over one day of data would be decoration.

export const dynamic = "force-dynamic";

function Tile({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
      <p className="text-xs text-black/50 dark:text-white/50">{label}</p>
      <p className="font-mono text-xl tabular-nums">
        {value}
        {unit && <span className="ml-1 text-sm text-black/50 dark:text-white/50">{unit}</span>}
      </p>
      {note && <p className="text-xs text-black/40 dark:text-white/40">{note}</p>}
    </div>
  );
}

export default async function Insights() {
  let events: UsageEvent[];
  try {
    events = await listUsage();
  } catch (error) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-lg font-semibold">Insights</h1>
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">
          Could not read usage events: {error instanceof Error ? error.message : String(error)}
        </p>
      </main>
    );
  }

  const answers = events.length;
  const sum = (pick: (event: UsageEvent) => number | undefined) =>
    events.reduce((total, event) => total + (pick(event) ?? 0), 0);

  const promptTokens = sum((event) => event.promptTokens);
  const completionTokens = sum((event) => event.completionTokens);
  const reasoningTokens = sum((event) => event.reasoningTokens);
  const cachedTokens = sum((event) => event.cachedTokens);
  const computeUnits = sum((event) => event.searchComputeUnits);
  const avg = (total: number) => (answers ? total / answers : 0);

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <header className="flex items-baseline justify-between border-b border-black/10 pb-3 dark:border-white/15">
        <div>
          <h1 className="text-lg font-semibold">Insights</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            What the copilot cost, and what it saved
          </p>
        </div>
        <Link href="/" className="text-sm underline underline-offset-4">
          back to chat
        </Link>
      </header>

      {answers === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">
          No answers recorded yet. Ask something on the{" "}
          <Link href="/" className="underline underline-offset-4">
            chat page
          </Link>{" "}
          and come back.
        </p>
      ) : (
        <>
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Measured</h2>
              <p className="text-xs text-black/50 dark:text-white/50">
                Read from the Azure APIs, not estimated.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Answers" value={String(answers)} />
              <Tile
                label="Tokens per answer"
                value={avg(promptTokens + completionTokens).toFixed(0)}
                note={`${avg(promptTokens).toFixed(0)} in / ${avg(completionTokens).toFixed(0)} out`}
              />
              <Tile
                label="First token"
                value={avg(sum((event) => event.ttftMs)).toFixed(0)}
                unit="ms"
                note={`full answer ${avg(sum((event) => event.totalLatencyMs)).toFixed(0)}ms`}
              />
              <Tile
                label="Search latency"
                value={avg(sum((event) => event.searchLatencyMs)).toFixed(0)}
                unit="ms"
              />
              <Tile
                label="Search compute"
                value={computeUnits.toFixed(5)}
                unit="CU"
                note="rate unpublished at build time"
              />
              <Tile
                label="Reasoning tokens"
                value={reasoningTokens.toFixed(0)}
                note={reasoningTokens === 0 ? "effort: minimal" : "billed as output"}
              />
              <Tile
                label="Cached prompt tokens"
                value={cachedTokens.toFixed(0)}
                note="billed at a discount"
              />
              <Tile
                label="Total tokens"
                value={(promptTokens + completionTokens).toLocaleString("en-US")}
              />
            </div>
          </section>

          <Assumptions
            answers={answers}
            promptTokens={promptTokens}
            completionTokens={completionTokens}
          />

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Recent answers</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-black/50 dark:text-white/50">
                  <tr className="border-b border-black/10 dark:border-white/15">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Question</th>
                    <th className="py-2 pr-3 text-right font-medium">Tokens</th>
                    <th className="py-2 pr-3 text-right font-medium">First token</th>
                    <th className="py-2 text-right font-medium">Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {events.slice(0, 25).map((event) => (
                    <tr
                      key={event.id}
                      className="border-b border-black/5 align-top dark:border-white/10"
                    >
                      <td className="py-2 pr-3 whitespace-nowrap font-mono text-xs tabular-nums text-black/50 dark:text-white/50">
                        {event.timestamp.slice(11, 16)}
                      </td>
                      <td className="max-w-md py-2 pr-3">{event.question}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">
                        {event.promptTokens + event.completionTokens}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">
                        {event.ttftMs ? `${event.ttftMs}ms` : "-"}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {event.sources.length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
