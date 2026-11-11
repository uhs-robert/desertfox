// Connects `create_host_update` to the browser: the signed build's hashes, the install type, storage and the toast.

import type { MergedConfig } from "../shared/config.ts";
import { show_toast_on_tab } from "./browser_deps.ts";
import type { HostHashes, HostUpdateDeps, HostUpdateState } from "./host_update.ts";
import { HOST_UPDATE_STORAGE_KEY } from "./storage_keys.ts";

function hashes_of(value: unknown): HostHashes | undefined {
  const { version, sha256 } = (value ?? {}) as { version?: unknown; sha256?: unknown };
  if (typeof version !== "string" || typeof sha256 !== "object" || sha256 === null) return undefined;
  const entries = Object.entries(sha256);
  return entries.length > 0 && entries.every(([, digest]) => typeof digest === "string") ? { version, sha256: Object.fromEntries(entries) as Record<string, string> } : undefined;
}

export const browser_host_update_deps = (get_config: () => Promise<MergedConfig>, update: HostUpdateDeps["update"], probe_host: HostUpdateDeps["probe_host"]): HostUpdateDeps => ({
  // A getter, because this module loads in tests with no `browser`.
  get extension_version() {
    return browser.runtime.getManifest().version;
  },
  is_development: async () => (await browser.management.getSelf()).installType === "development",
  // `just release_stamp` writes the file and the build copies it, so a signed build carries it and an unstamped build has none.
  read_hashes: async () => {
    try {
      return hashes_of(await (await fetch(browser.runtime.getURL("host_sha256.json"))).json());
    } catch {
      return undefined;
    }
  },
  auto_update_consented: async () => (await get_config()).settings.host_auto_update === true,
  update,
  probe_host,
  load_state: async () => ((await browser.storage.local.get(HOST_UPDATE_STORAGE_KEY))[HOST_UPDATE_STORAGE_KEY] as HostUpdateState | undefined) ?? {},
  save_state: (state) => browser.storage.local.set({ [HOST_UPDATE_STORAGE_KEY]: state }),
  now_ms: () => Date.now(),
  toast: async (message, kind) => {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    await show_toast_on_tab({ tab_id: tab?.id }, "host_update", message, kind);
  },
  warn: (text) => console.warn(text),
});
