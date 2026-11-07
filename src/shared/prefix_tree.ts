// Compiled keymap: the background writes it to `storage.local` under
// COMPILED_KEYMAP_STORAGE_KEY and the content script reads it before the first key.

import type { CountBehavior, RunsIn } from "./command.ts";
import type { BoundInvocation } from "./invocation.ts";
import type { ModeIndicator, WhichKeyBorder } from "./config.ts";
import type { KeymapMode } from "./keymap.ts";

export const COMPILED_KEYMAP_STORAGE_KEY = "desertfox_compiled_keymap";

export const COMPILED_KEYMAP_VERSION = 2;

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
  // The which-key hover text the binding wrote. Without one the row shows the command intent.
  intent?: string;
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
  // One regex source tested against the page URL. Absent when no site is ignored.
  ignore_regex?: string;
  mode_indicator: ModeIndicator;
  which_key_delay_ms: number;
  // A tree stored before this setting has none, and the panel keeps square corners.
  which_key_border?: WhichKeyBorder;
};

// A tree stored by an older build has another shape, and the content script then treats it as absent until the background recompiles.
export const current_keymap = (stored: CompiledKeymap | undefined): CompiledKeymap | undefined =>
  stored?.format_version === COMPILED_KEYMAP_VERSION ? stored : undefined;
