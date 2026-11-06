// Keymap data as the user writes it and as the default keymap ships.

import type { Mode } from "./command.ts";
import type { KeyBinding } from "./invocation.ts";

// `browser` holds the chords assigned to the Firefox shortcut slots.
export type KeymapMode = Mode | "browser";

// Vim-style key sequence, for example `J`, `sa`, `<A-j>`, `<S-Escape>`.
// `null` removes a default binding when a user keymap overrides it.
export type ModeBindings = Record<string, KeyBinding | null>;

export type Keymap = Partial<Record<KeymapMode, ModeBindings>>;

// A modifier key derives a variant of every key in its group. Its fields are args added to each variant, except `label`, which names the group in which-key and the help page.
export type Modifier = { label?: string } & Record<string, unknown>;

// `keymap` section of the merged config: the modes plus the generators.
export type KeymapConfig = Keymap & {
  // Last key of the sequence to search engine name.
  search_keys?: Record<string, string>;
  // Last key of the sequence to container name.
  container_keys?: Record<string, string>;
  // Last key of the sequence to the engines that key searches with, one per site. On a page, `s/<key>` runs the first engine whose `hosts` list the page and whose slots the page fills.
  site_keys?: Record<string, string[]>;
  // Key sequence of a modifier to the args it adds. `";r" = { rapid = true }` makes `;rl` from `;l`, and so on for each key of the `;` group that accepts the args. Normal mode only.
  modifiers?: Record<string, Modifier>;
  // Key sequence of a group to its name in which-key, for example `g` to `Go`. Applies to every mode that has the group.
  group_names?: Record<string, string>;
};
