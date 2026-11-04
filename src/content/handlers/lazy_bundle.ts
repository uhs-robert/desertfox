import type { BundleName } from "../../shared/bundles.ts";
import { bundles } from "../bundles.ts";
import type { ContentHandler } from "./types.ts";


// The code of these commands sits in a bundle that loads on the first run. A bundle that registers no handler yet refuses with `needs <bundle>`.
const from_bundle = (command_id: string, bundle: BundleName): ContentHandler => ({
  run: (args) => bundles.run_command(command_id, bundle, args, `needs ${bundle}`),
});

export const hint_run = from_bundle("hint.run", "hints");
export const cmdline_open = from_bundle("cmdline.open", "cmdline");
export const cmdline_next_completion = from_bundle("cmdline.next_completion", "cmdline");
export const cmdline_prev_completion = from_bundle("cmdline.prev_completion", "cmdline");

export const cmdline_submit = from_bundle("cmdline.submit", "cmdline");
export const cmdline_history = from_bundle("cmdline.history", "cmdline");
export const cmdline_clear = from_bundle("cmdline.clear", "cmdline");
export const caret_move = from_bundle("caret.move", "caret");
export const visual_act = from_bundle("visual.act", "caret");
export const help_whichkey = from_bundle("help.whichkey", "whichkey");
