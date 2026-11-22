// The long-lived services the config code and the commands call: snippets, the host updater, the native host client and the autoconfig mirror.

import { registry } from "../shared/registry/builtin.ts";
import type { MergedConfig } from "../shared/config.ts";
import { make_router_deps, snippet_deps } from "./browser_deps.ts";
import { no_repeat_memory } from "./repeat_memory.ts";
import { create_snippets } from "./snippets.ts";
import { browser_native_deps, create_native_client } from "./native_client.ts";
import { create_host_update } from "./host_update.ts";
import { browser_host_update_deps } from "./host_update_browser.ts";
import { create_autoconfig_mirror } from "./autoconfig_mirror.ts";

// The caller owns `get_config` and imports this file, so it passes the reader in. A direct import of `get_config` here would be a cycle.
// Creation order matters: the client takes the updater's `watch`, and the mirror takes the client's `write_autoconfig`.
export type Services = ReturnType<typeof create_services>;

export function create_services(deps: { get_config: () => Promise<MergedConfig> }) {
  const snippets = create_snippets(registry, snippet_deps, make_router_deps(deps.get_config, no_repeat_memory));
  // The updater needs the client to send `self_update`, and the client reports each reply to the updater, so the updater reads `native_host` late.
  const host_update = create_host_update(browser_host_update_deps(() => deps.get_config(), (request) => native_host.self_update(request)));
  const native_host = create_native_client(browser_native_deps(), host_update.watch);
  const autoconfig = create_autoconfig_mirror({ write_autoconfig: native_host.write_autoconfig, warn: console.warn });
  return { snippets, host_update, native_host, autoconfig };
}
