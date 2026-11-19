// The browser the config swap tests run against: storage in memory, and a native host that answers from `host`.

import { createHash } from "node:crypto";

export type Files = Record<string, string>;

// What the real host's `write_settings` does to the folder: replace settings.toml only while it still has the base digest.
// `old_host` answers as a host from before the verb.
function write_settings(host: { files: Files; old_host?: boolean }, message: { text?: string; base_sha256?: string | null }) {
  if (host.old_host) return { ok: false, error: "unknown cmd: 'write_settings'" };
  const on_disk = host.files["settings.toml"];
  const digest = on_disk === undefined ? null : createHash("sha256").update(on_disk, "utf8").digest("hex");
  if (digest !== message.base_sha256) return { ok: false, error: "/home/u/.config/desertfox/settings.toml changed on disk since DesertFox last read it, so it was not written" };
  host.files = { ...host.files, "settings.toml": message.text! };
  return { ok: true, path: "/home/u/.config/desertfox/settings.toml" };
}

// A browser that keeps storage in memory and answers the native host from `host`. A test rewrites `host.files` between reloads.
export function install_fake_browser(host: { files: Files; reply?: () => Promise<unknown>; granted?: boolean; old_host?: boolean }) {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const area = (store: Record<string, unknown>) => ({
    get: async (key?: string | string[]) => {
      const keys = key === undefined ? Object.keys(store) : [key].flat();
      return Object.fromEntries(keys.filter((name) => name in store).map((name) => [name, structuredClone(store[name])]));
    },
    set: async (values: Record<string, unknown>) => {
      Object.assign(store, structuredClone(values));
    },
    remove: async (key: string | string[]) => {
      for (const name of [key].flat()) delete store[name];
    },
  });
  const tabs: { id: number }[] = [];
  const told: number[] = [];
  const sent: { cmd: string; toml?: string; text?: string; base_sha256?: string | null }[] = [];
  const fake = {
    runtime: {
      id: "test@desertfox",
      // Not a release version, so the host updater has nothing to match a host to.
      getManifest: () => ({ version: "test" }),
      sendNativeMessage: async (_name: string, message: { cmd: string; toml?: string; text?: string; base_sha256?: string | null }) => {
        sent.push(message);
        if (host.reply) return host.reply();
        if (message.cmd === "write_autoconfig") return { ok: true };
        if (message.cmd === "write_settings") return write_settings(host, message);
        return { ok: true, config_dir: "/home/u/.config/desertfox", config_dir_exists: true, files: host.files };
      },
    },
    permissions: { contains: async () => host.granted !== false },
    storage: { local: area(local), session: area(session) },
    tabs: {
      query: async () => tabs.map((tab) => ({ ...tab })),
      sendMessage: async (tab_id: number) => void told.push(tab_id),
    },
    contextualIdentities: { query: async () => [] },
    commands: { update: async () => undefined, reset: async () => undefined },
  };
  Object.assign(globalThis, { browser: fake });
  return { local, session, tabs, told, sent, fake };
}
