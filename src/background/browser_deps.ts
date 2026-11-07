// The Firefox side of the router and the startup: each function wraps one browser call.

import type { MergedConfig } from "../shared/config.ts";
import type { PageInfo } from "../shared/engines/index.ts";
import { DEFAULT_CONTAINER_NAME, DEFAULT_COOKIE_STORE_ID } from "../shared/container_store.ts";
import type { BackgroundToContent, ContainerStore, Refusal, ToastKind } from "../shared/messages.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";
import { registry } from "../shared/registry/builtin.ts";
import { runs_with_empty } from "./availability.ts";
import type { BundleLoaderDeps } from "./bundle_loader.ts";
import type { ImageDeps, ImageKind } from "./image_actions.ts";
import { create_load_log } from "./load_log.ts";
import type { RepeatMemory } from "./repeat_memory.ts";
import type { ReinjectDeps } from "./reload.ts";
import { BUNDLE_LOADS_STORAGE_KEY } from "./storage_keys.ts";
import { deliver_refusal, deliver_toast } from "./refusal.ts";
import type { RouterDeps } from "./router.ts";
import type { SnippetDeps } from "./snippets.ts";

// Without a frame id the message reaches every frame, which shows a toast in each.
export function send_to_tab(tab_id: number, message: BackgroundToContent, frame_id?: number): Promise<unknown> {
  return browser.tabs.sendMessage(tab_id, message, frame_id === undefined ? {} : { frameId: frame_id });
}

// A warning, info or success toast on the command's tab, with the notification fallback a refusal has.
export async function show_toast_on_tab(ctx: { tab_id?: number | undefined; frame_id?: number | undefined }, id: string, message: string, kind: ToastKind): Promise<void> {
  await deliver_toast({ send_to_tab, notify }, ctx.tab_id, { id, message }, kind, ctx.frame_id);
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
  await browser.notifications.create({ type: "basic", title: "DesertFox", message: refusal.message });
}

// What the page slots read. `current_page` in commands/open_target.ts reads the same, but importing it here loops
// through startup.ts.
export async function page_of(tab_id: number | undefined): Promise<PageInfo | undefined> {
  const tab = tab_id === undefined ? undefined : await browser.tabs.get(tab_id).catch(() => undefined);
  return tab?.url ? { url: tab.url, ...(tab.title ? { title: tab.title } : {}) } : undefined;
}

export async function container_names(): Promise<string[]> {
  // Returns false or rejects when containers are off.
  const identities = await browser.contextualIdentities.query({}).catch(() => undefined);
  return Array.isArray(identities) ? identities.map((identity) => identity.name) : [];
}

// `default` first, then the containers. Empty with containers off, where a reopen has nowhere to go.
export async function container_stores(): Promise<ContainerStore[]> {
  const identities = await browser.contextualIdentities.query({}).catch(() => undefined);
  if (!Array.isArray(identities) || identities.length === 0) return [];
  return [{ name: DEFAULT_CONTAINER_NAME, cookie_store_id: DEFAULT_COOKIE_STORE_ID }, ...identities.map((identity) => ({ name: identity.name, cookie_store_id: identity.cookieStoreId }))];
}

export function make_router_deps(get_config: () => Promise<MergedConfig>, repeat_memory: RepeatMemory): RouterDeps {
  const channels = { send_to_tab, notify };
  return {
    get_command: (command_id) => registry.get(command_id),
    get_enum_sources: async (): Promise<EnumSources> => ({
      search_engines: Object.keys((await get_config()).search_engines),
      containers: await container_names(),
    }),
    active_tab: async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return tab?.id === undefined ? undefined : { tab_id: tab.id, window_id: tab.windowId ?? -1, url: tab.url, incognito: tab.incognito };
    },
    get_tab: async (tab_id) => {
      const tab = await browser.tabs.get(tab_id).catch(() => undefined);
      return tab?.id === undefined ? undefined : { tab_id: tab.id, window_id: tab.windowId ?? -1, url: tab.url, incognito: tab.incognito };
    },
    has_content_script,
    ask_selection: async (tab_id, frame_id) => {
      const answer: unknown = await send_to_tab(tab_id, { type: "get_selection" }, frame_id).catch(() => undefined);
      return typeof answer === "string" ? answer : undefined;
    },
    runs_with_empty: async (command_id, args, param, context) => runs_with_empty(await get_config(), command_id, args, param, await page_of(context.tab_id)),
    read_clipboard: () => navigator.clipboard.readText(),
    has_permission: (permission) => browser.permissions.contains({ permissions: [permission as browser._manifest.OptionalPermission] }),
    send_to_tab,
    open_cmdline: (tab_id, frame_id, text) => send_to_tab(tab_id, { type: "run_in_content", invocations: [{ id: "cmdline.open", args: { text } }] }, frame_id),
    show_refusal: (tab_id, refusal, frame_id) => deliver_refusal(channels, tab_id, refusal, frame_id),
    repeat_memory,
  };
}

// Frame 0 is the top frame: a snippet never runs in an iframe, whatever frame the key came from.
export const snippet_deps: SnippetDeps = {
  tab_url: async (tab_id) => (await browser.tabs.get(tab_id)).url,
  execute_in_top_frame: async (tab_id, code) => {
    const [result] = await browser.tabs.executeScript(tab_id, { code, frameId: 0, runAt: "document_idle" });
    return result;
  },
};

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

const bundle_load_log = create_load_log(
  { get: (key) => browser.storage.local.get(key), set: (items) => browser.storage.local.set(items) },
  BUNDLE_LOADS_STORAGE_KEY,
);

// Document start runs the script at once, so a page that is still loading does not hold the keys the bundle waits for.
export const bundle_loader_deps: BundleLoaderDeps = {
  inject: async ({ tab_id, frame_id }, file) => {
    const started_ms = performance.now();
    let ok = false;
    try {
      await browser.tabs.executeScript(tab_id, { file, frameId: frame_id, matchAboutBlank: true, runAt: "document_start" });
      ok = true;
    } finally {
      void bundle_load_log.record({ tab_id, frame_id, file, ok, ms: performance.now() - started_ms });
    }
  },
  timeout_ms: 10_000,
};

// The decode runs in the background page, where the fetched bytes are same-origin, so no canvas is tainted. `createImageBitmap` rejects an SVG, which an `Image` element decodes.
async function decode_to_canvas(bytes: ArrayBuffer, kind: ImageKind): Promise<OffscreenCanvas> {
  const blob = new Blob([bytes], { type: kind === "svg" ? "image/svg+xml" : "" });
  if (kind !== "svg") {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    return canvas;
  }
  const address = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = address;
    await image.decode();
    // An SVG without a size has no natural one.
    const canvas = new OffscreenCanvas(image.naturalWidth || 512, image.naturalHeight || 512);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(address);
  }
}

// Reads at most `limit` bytes, and gives up (undefined) as soon as the body is longer.
async function read_limited(response: Response, limit: number): Promise<ArrayBuffer | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return response.arrayBuffer();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    total += part.value.byteLength;
    if (total > limit) {
      void reader.cancel();
      return undefined;
    }
    chunks.push(part.value);
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return joined.buffer;
}

export const image_deps: ImageDeps = {
  fetch_image: async (address, timeout_ms, credentials) => {
    // The signal also covers the body read.
    const response = await fetch(address, { credentials, signal: AbortSignal.timeout(timeout_ms) });
    const declared = Number(response.headers.get("content-length"));
    return { ok: response.ok, declared_bytes: Number.isFinite(declared) && declared > 0 ? declared : undefined, read: (limit) => read_limited(response, limit) };
  },
  render_png: async (bytes, kind) => (await (await decode_to_canvas(bytes, kind)).convertToBlob({ type: "image/png" })).arrayBuffer(),
  set_image_data: (bytes, type) => browser.clipboard.setImageData(bytes, type),
  start_download: async (address, context) => {
    await browser.downloads.download({ url: address, saveAs: false, incognito: context.incognito, ...(context.cookie_store_id === undefined ? {} : { cookieStoreId: context.cookie_store_id }) });
  },
};
