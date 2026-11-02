// Keymap data as the user writes it and as the default keymap ships.

import type { Mode } from "./command.ts";
import type { KeyBinding } from "./invocation.ts";

// `browser` holds the chords assigned to the Firefox shortcut slots.
export type KeymapMode = Mode | "browser";

// Vim-style key sequence, for example `J`, `sa`, `<A-j>`, `<S-Escape>`.
// `null` removes a default binding when a user keymap overrides it.
export type ModeBindings = Record<string, KeyBinding | null>;

export type Keymap = Partial<Record<KeymapMode, ModeBindings>>;

// `keymap` section of the merged config: the modes plus two generators.
export type KeymapConfig = Keymap & {
  // Last key of the sequence to search engine name.
  search_keys?: Record<string, string>;
  // Last key of the sequence to container name.
  container_keys?: Record<string, string>;
};
