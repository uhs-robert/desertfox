// Compiled keymap: the background writes it to `storage.local` under
// COMPILED_KEYMAP_STORAGE_KEY and the content script reads it before the first key.

import type { CountBehavior, RunsIn } from "./command.ts";
import type { BoundInvocation } from "./invocation.ts";
import type { ModeIndicator, WhichKeyBorder } from "./config.ts";
import type { KeymapMode } from "./keymap.ts";
import type { ModeColors } from "./mode_colors.ts";

export const COMPILED_KEYMAP_STORAGE_KEY = "oasisfox_compiled_keymap";

export const COMPILED_KEYMAP_VERSION = 1;

// One step of a binding. The side that runs it and the count rule are resolved at compile time.
export type LeafStep = {
  invocation: BoundInvocation;
  runs_in: RunsIn;
  // How a numeric prefix applies, copied from the registry because the content script has none.
  count_rule: CountBehavior;
};

export type TreeLeaf = {
  kind: "leaf";
  // The which-key label of the key. The content script cannot load commands.json.
  label?: string;
  steps: LeafStep[];
};

export type TreeBranch = {
  kind: "branch";
  // The group name which-key shows. Without one it shows the prefix key.
  label?: string;
  // Keyed by one normalized key token, for example `g` or `<A-j>`.
  children: Record<string, TreeNode>;
};

export type TreeNode = TreeLeaf | TreeBranch;

export type CompiledKeymap = {
  format_version: typeof COMPILED_KEYMAP_VERSION;
  // Root branch per mode. A mode without bindings is absent.
  modes: Partial<Record<KeymapMode, TreeBranch>>;
  // Settings the content script needs before it can handle a key.
  ignore_sites: string[];
  mode_indicator: ModeIndicator;
  // Badge colors from the palette setting. A tree stored before 0.1.1 has none, and the badge keeps its plain colors.
  mode_colors?: ModeColors;
  which_key_delay_ms: number;
  // A tree stored before this setting has none, and the panel keeps square corners.
  which_key_border?: WhichKeyBorder;
};

