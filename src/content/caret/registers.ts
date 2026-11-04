// Named text registers over `storage.local`, as vim has them. Register `/` holds the last page search.
// A private window leaves nothing behind, so there a register lives in memory only.

import { REGISTER_STORAGE_PREFIX } from "../../background/storage_keys.ts";

const in_memory = new Map<string, string>();

export async function get_register(name: string): Promise<string | undefined> {
  const kept = in_memory.get(name);
  if (kept !== undefined || browser.extension.inIncognitoContext) return kept;
  const stored = (await browser.storage.local.get(REGISTER_STORAGE_PREFIX + name))[REGISTER_STORAGE_PREFIX + name];
  return typeof stored === "string" ? stored : undefined;
}

export async function set_register(name: string, text: string): Promise<void> {
  in_memory.set(name, text);
  if (!browser.extension.inIncognitoContext) await browser.storage.local.set({ [REGISTER_STORAGE_PREFIX + name]: text });
}
