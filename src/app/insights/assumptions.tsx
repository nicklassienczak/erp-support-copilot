"use client";

import { useState } from "react";

// The assumptions half of the ROI page.
//
// These four numbers cannot be measured, so they are inputs rather than
// constants. Anyone reading the savings figure can see exactly what it rests on
// and change it. A saving computed from hidden constants is the first thing a
// client's finance team pulls apart, and rightly.

type Props = {
  answers: number;
  promptTokens: number;
  completionTokens: number;
};

const field =
  "w-24 rounded border border-black/15 bg-transparent px-2 py-1 text-right font-mono text-sm tabular-nums outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50";

export function Assumptions({ answers, promptTokens, completionTokens }: Props) {
  // Defaults: token prices are third-party figures (Azure's page shows
  // placeholders for this model family); 8 minutes is a plausible manual
  // doc-hunt for one ERP support question; 850 DKK/h is a mid-range Danish
  // consulting rate.
  const [inputPrice, setInputPrice] = useState(0.75);
  const [outputPrice, setOutputPrice] = useState(4.5);
  const [minutesSaved, setMinutesSaved] = useState(8);
  const [hourlyRate, setHourlyRate] = useState(850);

  const tokenCost =
    (promptTokens / 1_000_000) * inputPrice + (completionTokens / 1_000_000) * outputPrice;
  const usdPerDkk = 6.9; // rough; only used to put both figures in one currency
  const tokenCostDkk = tokenCost * usdPerDkk;

  const hoursSaved = (answers * minutesSaved) / 60;
  const labourAvoided = hoursSaved * hourlyRate;
  const net = labourAvoided - tokenCostDkk;

  return (
    <section className="grid gap-6 md:grid-cols-2">
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Assumptions</h2>
        <p className="text-xs text-black/50 dark:text-white/50">
          Not measured. Change them and the figures on the right move.
        </p>

        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Input tokens, USD / 1M</span>
          <input
            type="number"
            step="0.01"
            value={inputPrice}
            onChange={(event) => setInputPrice(Number(event.target.value))}
            className={field}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Output tokens, USD / 1M</span>
          <input
            type="number"
            step="0.01"
            value={outputPrice}
            onChange={(event) => setOutputPrice(Number(event.target.value))}
            className={field}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Minutes saved per question</span>
          <input
            type="number"
            step="1"
            value={minutesSaved}
            onChange={(event) => setMinutesSaved(Number(event.target.value))}
            className={field}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Consultant rate, DKK / hour</span>
          <input
            type="number"
            step="50"
            value={hourlyRate}
            onChange={(event) => setHourlyRate(Number(event.target.value))}
            className={field}
          />
        </label>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Derived</h2>
        <p className="text-xs text-black/50 dark:text-white/50">
          Measured usage times the assumptions on the left.
        </p>

        <dl className="space-y-2 text-sm">
          <Row label="Hours saved" value={`${hoursSaved.toFixed(1)} h`} />
          <Row label="Labour cost avoided" value={`${labourAvoided.toFixed(0)} DKK`} />
          <Row
            label="Token spend"
            value={`${tokenCostDkk.toFixed(2)} DKK`}
            note={`$${tokenCost.toFixed(4)}`}
          />
          <Row
            label="Cost per answer"
            value={answers ? `${(tokenCostDkk / answers).toFixed(3)} DKK` : "-"}
          />
        </dl>

        <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
          <p className="text-xs text-black/50 dark:text-white/50">Net saving</p>
          <p className="font-mono text-2xl tabular-nums">{net.toFixed(0)} DKK</p>
          <p className="text-xs text-black/50 dark:text-white/50">
            {`over ${answers} ${answers === 1 ? "answer" : "answers"}`}
          </p>
        </div>
      </div>
    </section>
  );
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-black/5 pb-1 dark:border-white/10">
      <dt className="text-black/60 dark:text-white/60">{label}</dt>
      <dd className="font-mono tabular-nums">
        {value}
        {note && <span className="ml-2 text-xs text-black/40 dark:text-white/40">{note}</span>}
      </dd>
    </div>
  );
}
