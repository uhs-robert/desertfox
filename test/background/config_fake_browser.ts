// The browser the config swap tests run against: storage in memory, and a native host that answers from `host`.

import { createHash } from "node:crypto";

export type Files = Record<string, string>;

// One file of a `write_config_files` request.
export type FileEntry = { kind: string; name?: string; text: string | null; base_sha256: string | null };
type WriteMessage = { cmd: string; files?: FileEntry[] };

// The path the real host's kind table gives a file entry.
const FIXED_KIND_PATHS: Record<string, string> = {
  settings: "settings.toml",
  engines: "search_engines.d/zz-desertfox.toml",
  search_keys: "keymap.d/zz-desertfox.toml",
  keymap: "keymap.toml",
  search_engines: "search_engines.toml",
  command_aliases: "command_aliases.toml",
  quickmarks: "quickmarks.toml",
  style: "style.css",
};
const NAMED_KIND_FOLDERS: Record<string, [string, string]> = {
  theme: ["themes", ".toml"],
  settings_d: ["settings.d", ".toml"],
  keymap_d: ["keymap.d", ".toml"],
  search_engines_d: ["search_engines.d", ".toml"],
  command_aliases_d: ["command_aliases.d", ".toml"],
  quickmarks_d: ["quickmarks.d", ".toml"],
  style_d: ["style.d", ".css"],
};
const CONFIG_DIR = "/home/u/.config/desertfox";

export function kind_path(entry: { kind: string; name?: string }): string {
  const fixed = FIXED_KIND_PATHS[entry.kind];
  if (fixed !== undefined) return fixed;
  const [folder, ext] = NAMED_KIND_FOLDERS[entry.kind]!;
  return `${folder}/${entry.name}${ext}`;
}

// The file entries of every `write_config_files` request in `sent`, in the order sent.
export const files_sent = (sent: { cmd: string; files?: FileEntry[] }[]): FileEntry[] => sent.flatMap((message) => (message.cmd === "write_config_files" ? (message.files ?? []) : []));
// The config paths of each `write_config_files` request in `sent`, one list per request.
export const batches_sent = (sent: { cmd: string; files?: FileEntry[] }[]): string[][] => sent.flatMap((message) => (message.cmd === "write_config_files" ? [(message.files ?? []).map(kind_path)] : []));

const digest_of = (text: string | undefined): string | null => (text === undefined ? null : createHash("sha256").update(text, "utf8").digest("hex"));

// What the real host's `write_config_files` does to the folder: under one lock it checks every entry's kind and base, then replaces or deletes each file, all or none.
// `old_host` and `settings_only_host` answer as a host from before the batch verb (one that knows no write verb, and one that knows only `write_settings`).
// `no_engines_kind`, `no_keys_kind` and `no_import_kinds` answer as a host whose kind table lacks `engines`, lacks `search_keys`, or holds only the page's kinds, settings and themes.
// `refuse` fails the write of the paths it names, as a host that cannot write that file, and puts back the files written before it, all but those `unrestored` names, which keep the batch's text.
type FakeHostKinds = { old_host?: boolean; settings_only_host?: boolean; no_engines_kind?: boolean; no_keys_kind?: boolean; no_import_kinds?: boolean; refuse?: string[]; unrestored?: string[] };
const PAGE_HOST_KINDS = ["engines", "search_keys", "settings", "theme"];
function kinds_of(host: FakeHostKinds): string[] {
  if (host.no_engines_kind) return ["settings", "theme"];
  if (host.no_keys_kind) return ["engines", "settings", "theme"];
  if (host.no_import_kinds) return PAGE_HOST_KINDS;
  return [...Object.keys(FIXED_KIND_PATHS), ...Object.keys(NAMED_KIND_FOLDERS)];
}
function write_config_files(host: { files: Files } & FakeHostKinds, message: WriteMessage) {
  if (host.old_host || host.settings_only_host) return { ok: false, error: `unknown cmd: '${message.cmd}'` };
  const entries = message.files ?? [];
  const kinds = kinds_of(host);
  const unknown_kind = entries.find((entry) => !kinds.includes(entry.kind));
  if (unknown_kind) return { ok: false, error: `write_config_files has no kind '${unknown_kind.kind}'. It writes ${[...kinds].sort().join(", ")}` };
  const refused = (error: string, path: string, unrestored: string[] = []) => ({ ok: false, error, path: `${CONFIG_DIR}/${path}`, unrestored: unrestored.map((kept) => `${CONFIG_DIR}/${kept}`) });
  const paths = entries.map(kind_path);
  const twice = paths.find((path, index) => paths.indexOf(path) !== index);
  if (twice !== undefined) return refused(`write_config_files names ${CONFIG_DIR}/${twice} twice, so nothing was written`, twice);
  const stale = paths.find((path, index) => digest_of(host.files[path]) !== entries[index]!.base_sha256);
  if (stale !== undefined) return refused(`${CONFIG_DIR}/${stale} changed on disk since DesertFox last read it, so nothing was written`, stale);
  const failing = paths.findIndex((path) => host.refuse?.includes(path));
  const written = failing < 0 ? entries.length : failing;
  let files = host.files;
  entries.slice(0, written).forEach((entry, index) => {
    if (failing >= 0 && !host.unrestored?.includes(paths[index]!)) return;
    const { [paths[index]!]: _old, ...others } = files;
    files = entry.text === null ? others : { ...files, [paths[index]!]: entry.text };
  });
  host.files = files;
  if (failing >= 0) {
    const kept = paths.slice(0, failing).filter((path) => host.unrestored?.includes(path));
    const rollback = kept.length > 0 ? `. Of the ${failing} files written before it, ${kept.map((path) => `${CONFIG_DIR}/${path}`).join(", ")} could not be put back` : failing > 0 ? `. The ${failing} files written before it went back to their old text, so nothing was written` : "";
    return refused(`cannot write ${CONFIG_DIR}/${paths[failing]}: Permission denied${rollback}`, paths[failing]!, kept);
  }
  return { ok: true, files: entries.map((entry, index) => ({ path: `${CONFIG_DIR}/${paths[index]}`, ...(entry.text === null ? { deleted: true } : { sha256: digest_of(entry.text) }) })) };
}

// A browser that keeps storage in memory and answers the native host from `host`. A test rewrites `host.files` between reloads.
// `no_folder` answers as a host whose config folder is missing, and `autoconfig_fails` refuses every autoconfig.toml write.
export function install_fake_browser(host: { files: Files; reply?: () => Promise<unknown>; granted?: boolean; no_folder?: boolean; autoconfig_fails?: boolean } & FakeHostKinds) {
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
        if (message.cmd === "write_autoconfig") return host.autoconfig_fails ? { ok: false, error: "disk full" } : { ok: true };
        if (message.cmd === "write_config_files") return write_config_files(host, message);
        return { ok: true, config_dir: CONFIG_DIR, config_dir_exists: host.no_folder !== true, files: host.no_folder ? {} : host.files };
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
