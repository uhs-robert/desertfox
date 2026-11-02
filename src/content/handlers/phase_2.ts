import type { BundleName } from "../../shared/bundles.ts";
import { bundles } from "../bundles.ts";
import type { ContentHandler } from "./types.ts";

export const NEEDS_HINTS = "needs hints (phase 2)";
export const NEEDS_COMMAND_LINE = "needs the command line (phase 2)";

// The code of these commands sits in a bundle that loads on the first run. A bundle that registers no handler yet refuses with `missing`.
const from_bundle = (command_id: string, bundle: BundleName, missing: string): ContentHandler => ({
  run: (args) => bundles.run_command(command_id, bundle, args, missing),
});

export const hint_run = from_bundle("hint.run", "hints", NEEDS_HINTS);
export const cmdline_open = from_bundle("cmdline.open", "cmdline", NEEDS_COMMAND_LINE);
export const cmdline_next_completion = from_bundle("cmdline.next_completion", "cmdline", NEEDS_COMMAND_LINE);
export const cmdline_prev_completion = from_bundle("cmdline.prev_completion", "cmdline", NEEDS_COMMAND_LINE);

// Which-key has no bundle yet. Its timer slot and bundle come with the which-key piece.
export const help_whichkey: ContentHandler = {
  run: () => {
    throw new Error(NEEDS_COMMAND_LINE);
  },
};
