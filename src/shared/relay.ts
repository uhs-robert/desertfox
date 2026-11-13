// Which bundle handlers a frame may ask the background to run in another frame, and where. The table is the whole allow list: a frame names the handler and never the bundle.

import type { BundleName } from "./bundles.ts";
import type { Invocation } from "./invocation.ts";
import type { Relay } from "./messages.ts";

// `top` handlers draw in the top frame or take what the focused frame sends it. `frame` handlers act on one frame, named by its id.
const RELAYED: Record<string, { bundle: BundleName; to: "top" | "frame" }> = {
  "ui.toast": { bundle: "ui", to: "top" },
  "whichkey.draw": { bundle: "whichkey", to: "top" },
  "whichkey.erase": { bundle: "whichkey", to: "top" },
  "cmdline.open": { bundle: "cmdline", to: "top" },
  "cmdline.token": { bundle: "cmdline", to: "top" },
  "cmdline.headings": { bundle: "cmdline", to: "top" },
  "cmdline.find_status": { bundle: "cmdline", to: "top" },
  "cmdline.focus": { bundle: "cmdline", to: "frame" },
  "cmdline.end": { bundle: "cmdline", to: "frame" },
  "cmdline.headings_ask": { bundle: "cmdline", to: "frame" },
  "cmdline.find_text": { bundle: "cmdline", to: "frame" },
  "cmdline.find_end": { bundle: "cmdline", to: "frame" },
};

const TOP_FRAME = 0;

// The frame to send to and what it runs, or undefined for a request no frame may make. `from_frame` is set last, so no frame can name another as its sender.
export function relay_plan(request: Relay, sender_frame_id: number | undefined): { frame_id: number; invocation: Invocation } | undefined {
  const entry = Object.hasOwn(RELAYED, request.id) ? RELAYED[request.id] : undefined;
  const args = request.args;
  if (!entry || sender_frame_id === undefined || typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const frame_id = entry.to === "top" ? (request.to === "top" ? TOP_FRAME : undefined) : Number.isInteger(request.to) && (request.to as number) >= 0 ? (request.to as number) : undefined;
  if (frame_id === undefined) return undefined;
  return { frame_id, invocation: { id: request.id, args: { ...args, from_frame: sender_frame_id }, bundle: entry.bundle } };
}
