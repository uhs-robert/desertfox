// The browser the config swap tests run against: storage in memory, and a native host that answers from `host`.

import { createHash } from "node:crypto";

export type Files = Record<string, string>;

type WriteMessage = { cmd: string; kind?: string; name?: string; text?: string | null; base_sha256?: string | null };

// What the real host's `write_config_file` does to the folder: replace or delete the file the kind and name give, only while it still has the base digest.
// `old_host` answers as a host from before the write verbs, `settings_only_host` as one that knows `write_settings` alone, and `no_engines_kind` as one whose kind table lacks `engines`.
// `refuse` refuses a write of the paths it names, as a host that cannot write that file.
function write_config_file(host: { files: Files; old_host?: boolean; settings_only_host?: boolean; no_engines_kind?: boolean; refuse?: string[] }, message: WriteMessage) {
  if (host.old_host || (host.settings_only_host && message.cmd === "write_config_file")) return { ok: false, error: `unknown cmd: '${message.cmd}'` };
  if (host.no_engines_kind && message.kind === "engines") return { ok: false, error: "write_config_file has no kind 'engines'. It writes settings, theme" };
  const path = message.cmd === "write_settings" || message.kind === "settings" ? "settings.toml" : message.kind === "engines" ? "search_engines.d/zz-desertfox.toml" : `themes/${message.name}.toml`;
  if (host.refuse?.includes(path)) return { ok: false, error: `cannot write /home/u/.config/desertfox/${path}: Permission denied` };
  const on_disk = host.files[path];
  const digest = on_disk === undefined ? null : createHash("sha256").update(on_disk, "utf8").digest("hex");
  if (digest !== message.base_sha256) return { ok: false, error: `/home/u/.config/desertfox/${path} changed on disk since DesertFox last read it, so it was not written` };
  const { [path]: _old, ...others } = host.files;
  host.files = message.text === null || message.text === undefined ? others : { ...host.files, [path]: message.text };
  return { ok: true, path: `/home/u/.config/desertfox/${path}` };
}

// A browser that keeps storage in memory and answers the native host from `host`. A test rewrites `host.files` between reloads.
export function install_fake_browser(host: { files: Files; reply?: () => Promise<unknown>; granted?: boolean; old_host?: boolean; settings_only_host?: boolean; no_engines_kind?: boolean; refuse?: string[] }) {
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
  const sent: (WriteMessage & { toml?: string })[] = [];
  const fake = {
    runtime: {
      id: "test@desertfox",
      // Not a release version, so the host updater has nothing to match a host to.
      getManifest: () => ({ version: "test" }),
      sendNativeMessage: async (_name: string, message: WriteMessage & { toml?: string }) => {
        sent.push(message);
        if (host.reply) return host.reply();
        if (message.cmd === "write_autoconfig") return { ok: true };
        if (message.cmd === "write_config_file" || message.cmd === "write_settings") return write_config_file(host, message);
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

// Waits until `condition` holds, so a test that waits for a write to go out does not race a fixed pause on a loaded machine.
export async function until(condition: () => boolean, what: string, deadline_ms = 5000): Promise<void> {
  const deadline = Date.now() + deadline_ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`gave up waiting: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
