import type { BundleName } from "../../shared/bundles.ts";
import { bundles } from "../bundles.ts";
import type { ContentHandler } from "./types.ts";

const BUNDLE_LABELS: Record<string, string> = { hints: "hints", cmdline: "the command line", whichkey: "the which-key panel", caret: "caret mode" };

// The code of these commands sits in a bundle that loads on the first run. A bundle that registers no handler yet refuses with `needs <label>`.
const from_bundle = (command_id: string, bundle: BundleName): ContentHandler => ({
  run: (args) => bundles.run_command(command_id, bundle, args, `needs ${BUNDLE_LABELS[bundle]}`),
});

export const hint_run = from_bundle("hint.run", "hints");
export const cmdline_open = from_bundle("cmdline.open", "cmdline");
export const cmdline_next_completion = from_bundle("cmdline.next_completion", "cmdline");
export const cmdline_prev_completion = from_bundle("cmdline.prev_completion", "cmdline");

export const cmdline_submit = from_bundle("cmdline.submit", "cmdline");
export const cmdline_history = from_bundle("cmdline.history", "cmdline");
export const cmdline_clear = from_bundle("cmdline.clear", "cmdline");
export const cmdline_help = from_bundle("cmdline.help", "cmdline");
export const list_act = from_bundle("list.act", "cmdline");
export const caret_move = from_bundle("caret.move", "caret");
export const visual_act = from_bundle("visual.act", "caret");
export const find_open = from_bundle("find.open", "caret");
export const find_next = from_bundle("find.next", "caret");
export const find_prev = from_bundle("find.prev", "caret");
export const help_whichkey = from_bundle("help.whichkey", "whichkey");
