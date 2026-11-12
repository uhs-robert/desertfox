// Turns timings into one line per name: count, median, p95 and max, in milliseconds. Pure.

import type { Timing } from "./timing_log.ts";

export type TimingRow = { name: string; count: number; median: number; p95: number; max: number };

// Nearest rank on the sorted values: the smallest value that covers `fraction` of them.
function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

export function summarize_timings(timings: Timing[]): TimingRow[] {
  const by_name = new Map<string, number[]>();
  for (const [name, ms] of timings) by_name.set(name, [...(by_name.get(name) ?? []), ms]);
  return [...by_name.entries()]
    .map(([name, values]) => {
      const sorted = values.sort((a, b) => a - b);
      return { name, count: sorted.length, median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted[sorted.length - 1]! };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const ms_text = (ms: number) => (ms < 10 ? ms.toFixed(1) : String(Math.round(ms)));

// The text for pasting into a report.
export function format_timings(rows: TimingRow[]): string {
  if (rows.length === 0) return "No timings yet.";
  const width = Math.max(...rows.map((row) => row.name.length));
  const lines = rows.map((row) => `${row.name.padEnd(width)}  n=${row.count}  median=${ms_text(row.median)}ms  p95=${ms_text(row.p95)}ms  max=${ms_text(row.max)}ms`);
  return lines.join("\n");
}

// The toast: the slowest p95 only, because the full table is on the clipboard.
export function toast_summary(rows: TimingRow[]): string {
  if (rows.length === 0) return "No timings yet";
  const slowest = rows.reduce((a, b) => (b.p95 > a.p95 ? b : a));
  return `Timings copied: ${rows.length} kinds, slowest p95 ${slowest.name} ${ms_text(slowest.p95)} ms`;
}
