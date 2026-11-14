// The Firefox side of the router and the startup: each function wraps one browser call.

import { title_for_address } from "./bookmark_title.ts";
import type { CommandDef } from "../shared/command.ts";
import type { MergedConfig } from "../shared/config.ts";
import { engine_of_page } from "../shared/engines/index.ts";
import type { PageInfo } from "../shared/engines/index.ts";
import { DEFAULT_CONTAINER_NAME, DEFAULT_COOKIE_STORE_ID } from "../shared/container_store.ts";
import type { AddBundleScriptAnswer, BackgroundToContent, ContainerStore, Refusal, ToastKind } from "../shared/messages.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";
import { is_dynamic_values } from "../shared/registry/params.ts";
import { registry } from "../shared/registry/builtin.ts";
import { runs_with_empty } from "./availability.ts";
import { create_bundle_loader } from "./bundle_loader.ts";
import type { BundleLoaderDeps, LoadSender } from "./bundle_loader.ts";
import { is_extension_page } from "./extension_page.ts";
import type { ImageDeps, ImageKind } from "./image_actions.ts";
import { create_load_log } from "./load_log.ts";
import { browser_timing_log } from "./timing_browser.ts";
import type { RepeatMemory } from "./repeat_memory.ts";
import type { ReinjectDeps } from "./reload.ts";
import { BUNDLE_LOADS_STORAGE_KEY, DISABLED_STORAGE_KEY } from "./storage_keys.ts";
import { deliver_refusal, deliver_toast } from "./refusal.ts";
import type { RouterDeps } from "./router.ts";
import { ask_page_bundle, ask_selection } from "./selection_ask.ts";
import type { SelectionAskDeps } from "./selection_ask.ts";
import { browser_jump_store } from "./jump_store.ts";
import type { SnippetDeps } from "./snippets.ts";
import { ignore_refusal } from "../shared/swallow.ts";

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
  const tab = tab_id === undefined ? undefined : await ignore_refusal(browser.tabs.get(tab_id));
  return tab?.url ? { url: tab.url, ...(tab.title ? { title: tab.title } : {}) } : undefined;
}

export async function container_names(): Promise<string[]> {
  // Returns false or rejects when containers are off.
  const identities = await ignore_refusal(browser.contextualIdentities.query({}));
  return Array.isArray(identities) ? identities.map((identity) => identity.name) : [];
}

// `default` first, then the containers. Empty with containers off, where a reopen has nowhere to go.
export async function container_stores(): Promise<ContainerStore[]> {
  const identities = await ignore_refusal(browser.contextualIdentities.query({}));
  if (!Array.isArray(identities) || identities.length === 0) return [];
  return [{ name: DEFAULT_CONTAINER_NAME, cookie_store_id: DEFAULT_COOKIE_STORE_ID }, ...identities.map((identity) => ({ name: identity.name, cookie_store_id: identity.cookieStoreId }))];
}

export async function read_disabled(): Promise<boolean> {
  return (await browser.storage.local.get(DISABLED_STORAGE_KEY))[DISABLED_STORAGE_KEY] === true;
}

type DisabledStorage = Pick<typeof browser.storage.local, "get">;
type ChangeEvent = Pick<typeof browser.storage.onChanged, "addListener">;

// The off flag in memory for the router, which reads it on every run. It refills from storage and follows `storage.onChanged` (the pattern of `keymap_source.ts`), so a restart of the background starts empty.
// A read before the first fill reads storage itself and waits for that fill, so the flag is never guessed. A change that lands during a fill wins over the stale read.
export function create_disabled_source(storage: DisabledStorage, changed: ChangeEvent): () => Promise<boolean> {
  let copy: boolean | undefined;
  let filling: Promise<boolean> | undefined;
  let generation = 0;
  const fill = (): Promise<boolean> => {
    const started = generation;
    const reading: Promise<boolean> = storage
      .get(DISABLED_STORAGE_KEY)
      .then((stored) => {
        // A change during the read has set the copy already.
        if (started === generation) copy = stored[DISABLED_STORAGE_KEY] === true;
        return copy ?? stored[DISABLED_STORAGE_KEY] === true;
      })
      .finally(() => {
        if (filling === reading) filling = undefined;
      });
    filling = reading;
    return reading;
  };
  changed.addListener((changes, area) => {
    if (area !== "local" || !(DISABLED_STORAGE_KEY in changes)) return;
    generation++;
    copy = changes[DISABLED_STORAGE_KEY]?.newValue === true;
  });
  return async () => copy ?? (await (filling ?? fill()));
}

const browser_disabled_source: (() => Promise<boolean>) | undefined = typeof browser === "undefined" || browser.storage?.onChanged === undefined ? undefined : create_disabled_source(browser.storage.local, browser.storage.onChanged);

// Containers are asked of the browser only for a command with a param that lists them: the query is a round trip to the parent process.
export function create_enum_sources(search_engines: () => Promise<string[]>, containers: () => Promise<string[]>): (command?: CommandDef) => Promise<EnumSources> {
  const reads_containers = (command: CommandDef) => (command.params ?? []).some((param) => is_dynamic_values(param.values) && param.values.from === "containers");
  return async (command) => ({
    search_engines: await search_engines(),
    ...(command === undefined || reads_containers(command) ? { containers: await containers() } : {}),
  });
}

export function make_router_deps(get_config: () => Promise<MergedConfig>, repeat_memory: RepeatMemory): RouterDeps {
  const channels = { send_to_tab, notify };
  return {
    get_command: (command_id) => registry.get(command_id),
    get_enum_sources: create_enum_sources(async () => Object.keys((await get_config()).search_engines), container_names),
    active_tab: async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return tab?.id === undefined ? undefined : { tab_id: tab.id, window_id: tab.windowId ?? -1, url: tab.url, incognito: tab.incognito };
    },
    get_tab: async (tab_id) => {
      const tab = await ignore_refusal(browser.tabs.get(tab_id));
      return tab?.id === undefined ? undefined : { tab_id: tab.id, window_id: tab.windowId ?? -1, url: tab.url, incognito: tab.incognito };
    },
    has_content_script,
    ask_selection: (tab_id, frame_id) => ask_selection(selection_ask_deps, tab_id, frame_id),
    read_offset: async (tab_id) => {
      const answer = (await ask_page_bundle(jump_offset_ask_deps, tab_id, 0)) as { x?: unknown; y?: unknown; url?: unknown } | undefined;
      return typeof answer?.x === "number" && typeof answer.y === "number" && typeof answer.url === "string" ? { x: answer.x, y: answer.y, url: answer.url } : undefined;
    },
    record_jump: (window_id, is_private, entry) => browser_jump_store.push(window_id, is_private, entry),
    runs_with_empty: async (command_id, args, param, context) => runs_with_empty(await get_config(), command_id, args, param, await page_of(context.tab_id)),
    read_clipboard: () => navigator.clipboard.readText(),
    bookmark_title: async (url) => (url === undefined ? undefined : title_for_address(await browser.bookmarks.search({ url }), url)),
    search_query: async (url) => (url === undefined ? undefined : engine_of_page((await get_config()).search_engines, url)?.query),
    has_permission: (permission) => browser.permissions.contains({ permissions: [permission as browser._manifest.OptionalPermission] }),
    send_to_tab,
    open_cmdline: (tab_id, frame_id, text) => send_to_tab(tab_id, { type: "run_in_content", invocations: [{ id: "cmdline.open", args: { text }, bundle: "cmdline" }] }, frame_id),
    show_refusal: (tab_id, refusal, frame_id) => deliver_refusal(channels, tab_id, refusal, frame_id),
    is_disabled: browser_disabled_source ?? read_disabled,
    repeat_memory,
    record_timing: (command_id, ms) => void browser_timing_log.record(command_id, ms),
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

const is_own_page = (sender: LoadSender) => is_extension_page(sender, browser.runtime.id, browser.runtime.getURL(""));

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
      void bundle_load_log.record({ tab_id, frame_id, file, ok, route: "execute_script", ms: performance.now() - started_ms });
    }
  },
  // The extension page's own script adds the tag (src/shared/page_bundle_tag.ts), because `executeScript` is refused there.
  add_script_tag: async ({ tab_id, frame_id }, file) => {
    const started_ms = performance.now();
    let ok = false;
    try {
      const answer = (await send_to_tab(tab_id, { type: "add_bundle_script", file }, frame_id)) as AddBundleScriptAnswer | undefined;
      if (!answer?.ok) throw new Error(answer?.message ?? "the page did not answer");
      ok = true;
    } finally {
      void bundle_load_log.record({ tab_id, frame_id, file, ok, route: "page_tag", ms: performance.now() - started_ms });
    }
  },
  is_extension_page: is_own_page,
  timeout_ms: 10_000,
};

// The one loader of the background, so the content script's asks and the selection ask share its deadline.
export const bundle_loader = create_bundle_loader(bundle_loader_deps);

// The background knows no document id, so this load joins other selection loads only, never the content script's own load. A second run of page.js registers nothing.
const selection_ask_deps: SelectionAskDeps = {
  ask: (tab_id, frame_id) => send_to_tab(tab_id, { type: "get_selection" }, frame_id),
  load_page_bundle: async (tab_id, frame_id) => {
    const in_extension_page = is_own_page({ id: browser.runtime.id, url: (await browser.tabs.get(tab_id)).url, frameId: frame_id });
    return bundle_loader.load({ tab_id, frame_id, document_id: "", in_extension_page }, "page");
  },
};

const jump_offset_ask_deps: SelectionAskDeps = { ...selection_ask_deps, ask: (tab_id, frame_id) => send_to_tab(tab_id, { type: "get_jump_offset" }, frame_id) };

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
