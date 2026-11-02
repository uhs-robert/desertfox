import type { Keymap, KeymapConfig, KeymapMode, ModeBindings } from "../shared/keymap.ts";

const GENERATOR_KEYS = ["search_keys", "container_keys"] as const;

function merge_mode(defaults: ModeBindings | undefined, user: ModeBindings | undefined): ModeBindings {
  // A `null` stays: the compiler also uses it to drop a binding generated from search_keys or container_keys.
  return { ...defaults, ...user };
}

// The user keymap wins per key sequence. `null` removes a default binding.
export function merge_keymaps(defaults: KeymapConfig, user: KeymapConfig): KeymapConfig {
  const merged: KeymapConfig = {};
  const modes = new Set([...Object.keys(defaults), ...Object.keys(user)]);
  for (const name of modes) {
    if ((GENERATOR_KEYS as readonly string[]).includes(name)) continue;
    const mode = name as KeymapMode;
    (merged as Keymap)[mode] = merge_mode(defaults[mode], user[mode]);
  }
  for (const key of GENERATOR_KEYS) {
    const generated = { ...defaults[key], ...user[key] };
    if (Object.keys(generated).length > 0) merged[key] = generated;
  }
  return merged;
}
