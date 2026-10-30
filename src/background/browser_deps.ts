// The Firefox side of the router and the startup: each function wraps one browser call.

import type { BackgroundToContent, Refusal } from "../shared/messages.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";
import { registry } from "../shared/registry/index.ts";
import type { ReinjectDeps } from "./reload.ts";
import { deliver_refusal } from "./refusal.ts";
import type { RouterDeps } from "./router.ts";

// Without a frame id the message reaches every frame, which shows a toast in each.
export function send_to_tab(tab_id: number, message: BackgroundToContent, frame_id?: number): Promise<unknown> {
  return browser.tabs.sendMessage(tab_id, message, frame_id === undefined ? {} : { frameId: frame_id });
}

// A tab with no content script rejects the send, so a ping settles the question without content's help.
export async function has_content_script(tab_id: number): Promise<boolean> {
  try {
    await browser.tabs.sendMessage(tab_id, { type: "ping" });
    return true;
  } catch {
    return false;
  }
}

export async function notify(refusal: Refusal): Promise<void> {
  await browser.notifications.create({ type: "basic", title: "OasisFox", message: refusal.message });
}

export async function container_names(): Promise<string[]> {
  // Returns false or rejects when containers are off.
  const identities = await browser.contextualIdentities.query({}).catch(() => undefined);
  return Array.isArray(identities) ? identities.map((identity) => identity.name) : [];
}

export function make_router_deps(get_search_engine_names: () => Promise<string[]>): RouterDeps {
  const channels = { send_to_tab, notify };
  return {
    get_command: (command_id) => registry.get(command_id),
    get_enum_sources: async (): Promise<EnumSources> => ({
      search_engines: await get_search_engine_names(),
      containers: await container_names(),
    }),
    active_tab: async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return tab?.id === undefined ? undefined : { tab_id: tab.id, window_id: tab.windowId ?? -1, url: tab.url };
    },
    has_content_script,
    ask_selection: async (tab_id) => {
      const answer: unknown = await send_to_tab(tab_id, { type: "get_selection" }).catch(() => undefined);
      return typeof answer === "string" ? answer : undefined;
    },
    read_clipboard: () => navigator.clipboard.readText(),
    has_permission: (permission) => browser.permissions.contains({ permissions: [permission as browser._manifest.OptionalPermission] }),
    send_to_tab,
    show_refusal: (tab_id, refusal, frame_id) => deliver_refusal(channels, tab_id, refusal, frame_id),
  };
}

export const reinject_deps: ReinjectDeps = {
  list_tabs: async () => {
    const tabs = await browser.tabs.query({});
    return tabs.flatMap((tab) => (tab.id === undefined ? [] : [{ tab_id: tab.id, url: tab.url }]));
  },
  ping: has_content_script,
  inject: async (tab_id) => {
    await browser.tabs.executeScript(tab_id, { file: "content.js", allFrames: true, matchAboutBlank: true, runAt: "document_start" });
  },
};
