// The Worker behind `find_scan.ts`: one scan per Worker, answered once.
import { scan_regex } from "./regex_scan.ts";
import type { ScanRequest } from "./regex_scan.ts";

self.onmessage = (event: MessageEvent<ScanRequest>) => {
  const matches = scan_regex(event.data);
  self.postMessage(matches, { transfer: [matches.from.buffer, matches.to.buffer] });
};
