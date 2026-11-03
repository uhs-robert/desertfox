import type { BundleName } from "../../shared/bundles.ts";
import { bundles } from "../bundles.ts";
import type { ContentHandler } from "./types.ts";

export const NEEDS_HINTS = "needs hints (phase 2)";
export const NEEDS_COMMAND_LINE = "needs the command line (phase 2)";
export const NEEDS_WHICH_KEY = "needs the which-key panel";
export const NEEDS_CARET = "needs caret mode (phase 2)";

// The code of these commands sits in a bundle that loads on the first run. A bundle that registers no handler yet refuses with `missing`.
const from_bundle = (command_id: string, bundle: BundleName, missing: string): ContentHandler => ({
  run: (args) => bundles.run_command(command_id, bundle, args, missing),
});

export const hint_run = from_bundle("hint.run", "hints", NEEDS_HINTS);
export const cmdline_open = from_bundle("cmdline.open", "cmdline", NEEDS_COMMAND_LINE);
export const cmdline_next_completion = from_bundle("cmdline.next_completion", "cmdline", NEEDS_COMMAND_LINE);
export const cmdline_prev_completion = from_bundle("cmdline.prev_completion", "cmdline", NEEDS_COMMAND_LINE);

export const cmdline_submit = from_bundle("cmdline.submit", "cmdline", NEEDS_COMMAND_LINE);
export const cmdline_history = from_bundle("cmdline.history", "cmdline", NEEDS_COMMAND_LINE);
export const cmdline_clear = from_bundle("cmdline.clear", "cmdline", NEEDS_COMMAND_LINE);
export const caret_move = from_bundle("caret.move", "caret", NEEDS_CARET);
export const visual_act = from_bundle("visual.act", "caret", NEEDS_CARET);
export const help_whichkey = from_bundle("help.whichkey", "whichkey", NEEDS_WHICH_KEY);
