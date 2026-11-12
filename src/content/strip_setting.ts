// The `strip_tracking_params` setting as the page and hints bundles read it: the stored value when it is a list of text, else the shipped list.

import { CONFIG_STATUS_STORAGE_KEY } from "../background/storage_keys.ts";
import { DEFAULT_STRIP_TRACKING_PARAMS } from "../shared/default_settings.ts";

export async function read_strip_patterns(): Promise<readonly string[]> {
  const stored = await browser.storage.local.get(CONFIG_STATUS_STORAGE_KEY);
  const chosen = (stored[CONFIG_STATUS_STORAGE_KEY] as { settings?: Record<string, unknown> } | undefined)?.settings?.strip_tracking_params;
  return Array.isArray(chosen) && chosen.every((entry) => typeof entry === "string") ? chosen : DEFAULT_STRIP_TRACKING_PARAMS;
}
