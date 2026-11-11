// The tab verbs of the bridge: list, activate, close and capture the tabs of normal windows, and hand over their stored icons, for a picker or a script outside the browser.
// A private window never shows up here: every verb starts from `normal_tab`, and a tab it does not return is answered "no such tab",
// the same text as for an id that never existed, so a caller cannot probe for private tabs. A failure carries fixed text, never a tab title.

export type TabInfo = {
  id?: number | undefined;
  windowId?: number | undefined;
  title?: string | undefined;
  url?: string | undefined;
  active?: boolean | undefined;
  audible?: boolean | undefined;
  discarded?: boolean | undefined;
  lastAccessed?: number | undefined;
  pinned?: boolean | undefined;
  hidden?: boolean | undefined;
  favIconUrl?: string | undefined;
  incognito?: boolean | undefined;
  width?: number | undefined;
  height?: number | undefined;
};

export type WindowInfo = { id?: number | undefined; type?: string | undefined; incognito?: boolean | undefined };

export type TabSwitchDeps = {
  windows: () => Promise<WindowInfo[]>;
  window: (window_id: number) => Promise<WindowInfo | undefined>;
  last_focused_window: () => Promise<WindowInfo | undefined>;
  tabs: () => Promise<TabInfo[]>;
  tab: (tab_id: number) => Promise<TabInfo | undefined>;
  select: (tab_id: number) => Promise<void>;
  focus_window: (window_id: number) => Promise<void>;
  set_preface: (window_id: number, text: string) => Promise<void>;
  remove: (tab_id: number) => Promise<void>;
  capture: (tab_id: number, options: { format: "jpeg"; quality: number; scale?: number }) => Promise<string>;
  // Runs `run` once after `delay_ms`.
  after: (run: () => void, delay_ms: number) => void;
};

// `favicon` is asked by the host alone, to fill its icon cache. The socket does not offer it.
export const TAB_VERBS = ["tabs", "activate", "clear_preface", "close", "capture", "favicon"] as const;
export type TabVerb = (typeof TAB_VERBS)[number];

export type TabAnswer = { ok: true; [field: string]: unknown } | { ok: false; message: string };

// The caller clears the preface when it has found the window. This is for a caller that died first.
export const PREFACE_LIFETIME_MS = 10_000;
const PREFACE_PATTERN = /^[A-Za-z0-9]{1,32}$/;
// A thumbnail fits this box, big enough for a large preview on a 1440p screen and small enough for one native message.
const THUMBNAIL_MAX_WIDTH = 1280;
const THUMBNAIL_MAX_HEIGHT = 960;
const THUMBNAIL_JPEG_QUALITY = 80;
// A larger icon would outgrow the host's message cap, so it gets no key and the host never asks for it.
const MAX_STORED_ICON_CHARS = 512 * 1024;

const refuse = (message: string): TabAnswer => ({ ok: false, message });
const NO_SUCH_TAB = refuse("no such tab");
const is_whole = (value: unknown): value is number => Number.isInteger(value);
const is_normal_window = (window: WindowInfo | undefined): boolean => window?.type === "normal" && window.incognito === false;
// Firefox hands most icons over as data URLs. A list of them would outgrow one native message, so a row carries the hash and the host asks for the icons it lacks.
const is_stored_icon = (url: string | undefined): url is string => url !== undefined && url.startsWith("data:image/") && url.length <= MAX_STORED_ICON_CHARS;

async function sha256_hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function create_tab_switch(deps: TabSwitchDeps) {
  // The nonce each window shows, so a late clear from an older activation leaves a newer one alone. It lives for 10 s at most, so a restart of the background loses nothing worth storing.
  const prefaces = new Map<number, string>();
  // Activations and clears run one after another: two at once would race on the window title, and a clear must not read the map between an activation's title write and its map write.
  let title_turns: Promise<unknown> = Promise.resolve();
  function in_turn<T>(work: () => Promise<T>): Promise<T> {
    const turn = title_turns.then(work);
    title_turns = turn.catch(() => undefined);
    return turn;
  }

  async function normal_tab(tab_id: unknown): Promise<TabInfo | undefined> {
    if (!is_whole(tab_id)) return undefined;
    const tab = await deps.tab(tab_id).catch(() => undefined);
    if (tab?.id === undefined || tab.windowId === undefined || tab.incognito !== false) return undefined;
    return is_normal_window(await deps.window(tab.windowId).catch(() => undefined)) ? tab : undefined;
  }

  // With `current`, only the active tab of the last focused window, and none when that window is private or a popup.
  async function list(request: { current?: unknown }): Promise<TabAnswer> {
    const current = request.current === true;
    const windows = current ? [await deps.last_focused_window()] : await deps.windows();
    const normal_ids = new Set(windows.filter(is_normal_window).map((window) => window?.id));
    const tabs = (await deps.tabs()).filter((tab) => tab.id !== undefined && tab.windowId !== undefined && tab.incognito === false && normal_ids.has(tab.windowId) && (!current || tab.active === true));
    const icon_keys = await Promise.all(tabs.map((tab) => (is_stored_icon(tab.favIconUrl) ? sha256_hex(tab.favIconUrl) : "")));
    return {
      ok: true,
      tabs: tabs.map((tab, index) => ({
        tab_id: tab.id,
        window_id: tab.windowId,
        title: tab.title ?? "",
        url: tab.url ?? "",
        active: tab.active === true,
        audible: tab.audible === true,
        discarded: tab.discarded === true,
        last_accessed: tab.lastAccessed ?? 0,
        pinned: tab.pinned === true,
        hidden: tab.hidden === true,
        fav_icon_url: tab.favIconUrl && !tab.favIconUrl.startsWith("data:") ? tab.favIconUrl : "",
        fav_icon_key: icon_keys[index],
      })),
    };
  }

  // The window is raised too, because Firefox does not reliably raise the window of a tab it selects. The compositor tells that window from others with the same title by the nonce in front of it (`clear_preface` takes it away).
  async function activate_now(request: { tab_id?: unknown; preface?: unknown }): Promise<TabAnswer> {
    const { preface } = request;
    if (preface !== undefined && !(typeof preface === "string" && PREFACE_PATTERN.test(preface))) return refuse("preface is letters and digits only");
    const tab = await normal_tab(request.tab_id);
    if (!tab) return NO_SUCH_TAB;
    const window_id = tab.windowId as number;
    try {
      await deps.select(tab.id as number);
    } catch {
      return refuse("the tab could not be activated");
    }
    const result = { ok: true as const, window_id, focused: false, preface_set: false };
    try {
      await deps.focus_window(window_id);
      result.focused = true;
    } catch {
      // The tab is selected, which is the part that matters.
    }
    if (preface !== undefined) {
      try {
        await deps.set_preface(window_id, `${preface} `);
        prefaces.set(window_id, preface);
        result.preface_set = true;
        deps.after(() => void clear_preface({ window_id, preface }).catch(() => undefined), PREFACE_LIFETIME_MS);
      } catch {
        // A window without a preface is still found by the caller's fallback.
      }
    }
    return result;
  }

  async function clear_preface_now(request: { window_id?: unknown; preface?: unknown }): Promise<TabAnswer> {
    const { window_id, preface } = request;
    if (!is_whole(window_id) || (preface !== undefined && !(typeof preface === "string" && PREFACE_PATTERN.test(preface)))) return refuse("clear_preface needs a window_id and, optionally, the preface");
    if (!is_normal_window(await deps.window(window_id).catch(() => undefined))) return refuse("no such window");
    if (preface !== undefined && prefaces.get(window_id) !== preface) return { ok: true, cleared: false };
    await deps.set_preface(window_id, "");
    prefaces.delete(window_id);
    return { ok: true, cleared: true };
  }

  const activate = (request: { tab_id?: unknown; preface?: unknown }) => in_turn(() => activate_now(request));
  const clear_preface = (request: { window_id?: unknown; preface?: unknown }) => in_turn(() => clear_preface_now(request));

  async function close(request: { tab_id?: unknown }): Promise<TabAnswer> {
    const tab = await normal_tab(request.tab_id);
    if (!tab) return NO_SUCH_TAB;
    await deps.remove(tab.id as number);
    return { ok: true };
  }

  // The host owns the thumbnail cache, so this only renders the tab and hands back the image with the address it shows. A tab that is not loaded is refused, because capturing it would load it.
  async function capture(request: { tab_id?: unknown }): Promise<TabAnswer> {
    const tab = await normal_tab(request.tab_id);
    if (!tab) return NO_SUCH_TAB;
    if (tab.discarded === true) return refuse("the tab is not loaded");
    const options: { format: "jpeg"; quality: number; scale?: number } = { format: "jpeg", quality: THUMBNAIL_JPEG_QUALITY };
    if (tab.width !== undefined && tab.height !== undefined && tab.width > 0 && tab.height > 0) options.scale = Math.min(1, THUMBNAIL_MAX_WIDTH / tab.width, THUMBNAIL_MAX_HEIGHT / tab.height);
    return { ok: true, tab_id: tab.id, url: tab.url ?? "", data_url: await deps.capture(tab.id as number, options) };
  }

  async function favicon(request: { tab_id?: unknown }): Promise<TabAnswer> {
    const tab = await normal_tab(request.tab_id);
    if (!tab) return NO_SUCH_TAB;
    return is_stored_icon(tab.favIconUrl) ? { ok: true, data_url: tab.favIconUrl } : refuse("the tab has no stored icon");
  }

  async function handle(verb: TabVerb, request: Record<string, unknown>): Promise<TabAnswer> {
    try {
      if (verb === "tabs") return await list(request);
      if (verb === "favicon") return await favicon(request);
      if (verb === "activate") return await activate(request);
      if (verb === "clear_preface") return await clear_preface(request);
      if (verb === "close") return await close(request);
      return await capture(request);
    } catch {
      // Fixed text: a browser error can carry a tab title.
      return refuse(`${verb} failed`);
    }
  }

  // Lets the bridge decide whether a tab id may be targeted by `run --tab`.
  return { handle, normal_tab };
}

export type TabSwitch = ReturnType<typeof create_tab_switch>;
