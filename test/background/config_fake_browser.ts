// The browser the config swap tests run against: storage in memory, and a native host that answers from `host`.

export type Files = Record<string, string>;

// A browser that keeps storage in memory and answers the native host from `host`. A test rewrites `host.files` between reloads.
export function install_fake_browser(host: { files: Files; reply?: () => Promise<unknown>; granted?: boolean }) {
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
  });
  const tabs: { id: number }[] = [];
  const told: number[] = [];
  const sent: { cmd: string; toml?: string }[] = [];
  const fake = {
    runtime: {
      id: "test@desertfox",
      sendNativeMessage: async (_name: string, message: { cmd: string; toml?: string }) => {
        sent.push(message);
        if (host.reply) return host.reply();
        if (message.cmd === "write_autoconfig") return { ok: true };
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
