import type { Keymap, KeymapConfig, KeymapMode, ModeBindings } from "../shared/keymap.ts";

const GENERATOR_KEYS = ["search_keys", "container_keys", "site_keys", "modifiers", "group_names"] as const;

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
    if (Object.keys(generated).length > 0) (merged as Record<string, unknown>)[key] = generated;
  }
  return merged;
}

// The part of the defaults the user did not override or null: the keys the compiler may drop when a user key extends one.
export function default_layer_of(defaults: KeymapConfig, user: KeymapConfig): KeymapConfig {
  const kept = (own: Record<string, unknown> | undefined, over: Record<string, unknown> | undefined) =>
    Object.fromEntries(Object.entries(own ?? {}).filter(([key]) => !(key in (over ?? {}))));
  const layer: Record<string, unknown> = {};
  for (const name of Object.keys(defaults)) {
    if (name === "modifiers" || name === "group_names") continue;
    layer[name] = kept(defaults[name as keyof KeymapConfig] as Record<string, unknown>, user[name as keyof KeymapConfig] as Record<string, unknown>);
  }
  return layer as KeymapConfig;
}
