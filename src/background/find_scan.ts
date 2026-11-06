// Answers `find_scan`: runs one regex page search in a fresh Worker and stops it after a time limit.
// A fresh Worker per scan, because `terminate` is the only way to stop a running `exec`, and a stopped Worker cannot be reused.

import type { FindScanAnswer } from "../shared/messages.ts";
import type { RegexMatches, ScanRequest } from "./regex_scan.ts";

export const FIND_SCAN_LIMIT_MS = 300;

export type ScanWorker = {
  postMessage: (request: ScanRequest) => void;
  terminate: () => void;
  onmessage: ((event: { data: RegexMatches }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
};

export type FindScanDeps = {
  start_worker: () => ScanWorker;
  set_timer: (callback: () => void, delay_ms: number) => unknown;
  clear_timer: (handle: unknown) => void;
  limit_ms: number;
};

export function create_find_scan(deps: FindScanDeps) {
  // One scan per frame: a newer keystroke in the same frame ends the older scan's Worker at once.
  const running = new Map<string, () => void>();

  return {
    // `frame_key` names the sender's tab and frame.
    answer(request: ScanRequest, frame_key: string): Promise<FindScanAnswer> {
      running.get(frame_key)?.();
      return new Promise((resolve) => {
        let settled = false;
        let worker: ScanWorker | undefined;
        let timer: unknown;
        const finish = (answer: FindScanAnswer) => {
          if (settled) return;
          settled = true;
          deps.clear_timer(timer);
          worker?.terminate();
          if (running.get(frame_key) === supersede) running.delete(frame_key);
          resolve(answer);
        };
        const supersede = () => finish({ ok: false, reason: "superseded" });
        running.set(frame_key, supersede);
        timer = deps.set_timer(() => finish({ ok: false, reason: "timeout" }), deps.limit_ms);
        try {
          worker = deps.start_worker();
          worker.onmessage = ({ data }) => finish({ ok: true, from: data.from, to: data.to });
          worker.onerror = ({ message }) => finish({ ok: false, reason: "failed", message: message ?? "the search worker failed" });
          worker.postMessage(request);
        } catch (error) {
          finish({ ok: false, reason: "failed", message: (error as Error).message });
        }
      });
    },
  };
}

export const is_scan_request = (value: { text?: unknown; source?: unknown; flags?: unknown }): value is ScanRequest =>
  typeof value.text === "string" && typeof value.source === "string" && typeof value.flags === "string";

export function browser_find_scan_deps(): FindScanDeps {
  const worker_url = browser.runtime.getURL("find_worker.js");
  return {
    start_worker: () => new Worker(worker_url) as unknown as ScanWorker,
    set_timer: (callback, delay_ms) => setTimeout(callback, delay_ms),
    clear_timer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    limit_ms: FIND_SCAN_LIMIT_MS,
  };
}
