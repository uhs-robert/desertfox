// A stand-in for the Firefox globals the browser module reads, so its files run in a `vm` context as the drop-in loader runs them: once per window, then in a sandbox.
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const MODULE_DIR_URL = "file:///usr/lib/firefox/chrome.d/";
const module_dir = new URL("../../browser_module/", import.meta.url);
export const CORE_FILE = "desertfox-browser.js";
export const FEATURE_FILE = "desertfox-tabs-scroll.js";
export const source_of = (name: string): string => readFileSync(new URL(name, module_dir), "utf8");

export const IME_DISABLED = 0;
export const IME_ENABLED = 2;
const IME_PASSWORD = 3;

type Listener = (event: FakeEvent) => void;
export type FakeEvent = {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isTrusted: boolean;
  isComposing: boolean;
  keyCode: number;
  repeat: boolean;
  defaultPrevented: boolean;
  target: unknown;
  originalTarget: unknown;
  prevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
};

export function key_event(key: string, patch: Partial<FakeEvent> = {}): FakeEvent {
  const event: FakeEvent = {
    key,
    code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : "",
    shiftKey: /^[A-Z]$/.test(key),
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isTrusted: true,
    isComposing: false,
    keyCode: 0,
    repeat: false,
    defaultPrevented: false,
    target: undefined,
    originalTarget: undefined,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    ...patch,
  };
  return event;
}

export type FakeExtension = { id: string; privateBrowsingAllowed: boolean; bucket: Map<string, unknown> };
// The holder the extension's storage keeps: the module must deserialize it.
const holder_of = (value: unknown) => ({ deserialize: () => structuredClone(value) });

// `pref: null` leaves the pref unset.
export function create_firefox({ pref = true as boolean | string | null } = {}) {
  const errors: string[] = [];
  const prefs = new Map<string, unknown>();
  if (pref !== null) prefs.set("desertfox.browser_module.enabled", pref);
  const pref_observers: (() => void)[] = [];
  const ready_listeners: ((name: string, extension: FakeExtension) => void)[] = [];
  const frame_scripts: string[] = [];
  const message_listeners = new Map<string, ((message: { target: unknown; data: unknown }) => void)[]>();
  const sent_to_frames: { browser: unknown; name: string; data: unknown }[] = [];
  const tab_ids = new Map<unknown, number>();
  let next_tab_id = 1;
  const firefox = {
    extension: undefined as FakeExtension | undefined,
    fail_import: false,
    fail_tab_ids: false,
    errors,
    frame_scripts,
    sent_to_frames,
    sandboxes: 0,
  };

  // The file a load runs, so Components.stack names it as Firefox does.
  let running_file = "";
  // Code inside a context sees its global through a proxy, which vm does not take back as the context.
  const context_of_global = new Map<unknown, vm.Context>();
  const contextify = (object: object) => {
    const context = vm.createContext(object);
    context_of_global.set(vm.runInContext("globalThis", context), context);
    return context;
  };
  const run_file = (name: string, context: vm.Context) => {
    const before = running_file;
    running_file = MODULE_DIR_URL + name;
    try {
      vm.runInContext(source_of(name), context, { filename: name });
    } finally {
      running_file = before;
    }
  };

  const Services: Record<string, unknown> = {
    prefs: {
      getBoolPref(name: string, fallback: boolean) {
        if (!prefs.has(name)) return fallback;
        const value = prefs.get(name);
        if (typeof value !== "boolean") throw new Error("NS_ERROR_UNEXPECTED");
        return value;
      },
      addObserver(_name: string, observer: () => void) {
        pref_observers.push(observer);
      },
    },
    mm: {
      loadFrameScript(url: string) {
        frame_scripts.push(url);
      },
      addMessageListener(name: string, listener: (message: { target: unknown; data: unknown }) => void) {
        message_listeners.set(name, [...(message_listeners.get(name) ?? []), listener]);
      },
    },
    scriptSecurityManager: { getSystemPrincipal: () => ({}) },
    scriptloader: {
      loadSubScriptWithOptions(url: string, { target }: { target: vm.Context }) {
        if (!url.startsWith(MODULE_DIR_URL)) throw new Error(`untrusted ${url}`);
        run_file(url.slice(MODULE_DIR_URL.length), context_of_global.get(target) ?? target);
      },
    },
  };
  const Components = {
    get stack() {
      return { filename: running_file };
    },
    interfaces: { nsIDOMWindowUtils: { IME_STATUS_DISABLED: IME_DISABLED, IME_STATUS_ENABLED: IME_ENABLED, IME_STATUS_PASSWORD: IME_PASSWORD } },
    utils: {
      reportError: (text: unknown) => errors.push(String(text)),
      Sandbox: () => {
        firefox.sandboxes++;
        return contextify({ Services, Components, ChromeUtils });
      },
    },
  };
  const ChromeUtils = {
    importESModule(url: string) {
      if (firefox.fail_import) throw new Error(`no module ${url}`);
      return {
        ExtensionParent: {
          GlobalManager: { getExtension: (id: string) => (firefox.extension?.id === id ? firefox.extension : undefined) },
          apiManager: {
            global: {
              tabTracker: {
                getId(tab: unknown) {
                  if (firefox.fail_tab_ids) throw new Error("tabTracker changed");
                  if (!tab_ids.has(tab)) tab_ids.set(tab, next_tab_id++);
                  return tab_ids.get(tab);
                },
              },
            },
          },
        },
        ExtensionStorage: { serialize: (_name: string, _anonymized: string, value: unknown) => holder_of(value) },
        extensionStorageSession: {
          get: (extension: FakeExtension, keys: string[]) => Object.fromEntries(keys.filter((key) => extension.bucket.has(key)).map((key) => [key, extension.bucket.get(key)])),
          set: (extension: FakeExtension, items: Record<string, unknown>) => Object.entries(items).forEach(([key, value]) => extension.bucket.set(key, value)),
          remove: (extension: FakeExtension, keys: string[]) => keys.forEach((key) => extension.bucket.delete(key)),
        },
        Management: { on: (_event: string, listener: (name: string, extension: FakeExtension) => void) => ready_listeners.push(listener) },
        PrivateBrowsingUtils: { isWindowPrivate: (win: { private_window?: boolean }) => win.private_window === true },
      };
    },
  };

  const make_window = ({ private_window = false } = {}) => {
    const listeners = new Map<string, Set<Listener>>();
    const tabs = new Map<unknown, { browser: unknown }>();
    const tab_moves: number[] = [];
    const document = { localName: "document" };
    const win = {
      private_window,
      document,
      windowUtils: { IMEStatus: IME_DISABLED },
      gBrowser: {
        getTabForBrowser: (browser: unknown) => [...tabs.values()].find((tab) => tab.browser === browser) ?? null,
        tabContainer: { advanceSelectedTab: (step: number) => tab_moves.push(step) },
      },
      addEventListener(type: string, listener: Listener) {
        listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
      },
      removeEventListener(type: string, listener: Listener) {
        listeners.get(type)?.delete(listener);
      },
      context: undefined as vm.Context | undefined,
    };
    // The loader runs every drop-in in the window itself.
    const load = () => {
      // The window is the global of the files it loads, as with the loader's `target: win`.
      win.context ??= contextify(Object.assign(win, { Services, Components, ChromeUtils, window: win }));
      for (const name of [CORE_FILE, FEATURE_FILE]) {
        try {
          run_file(name, win.context);
        } catch (error) {
          errors.push(`loader: ${name} threw ${String(error)}`);
        }
      }
    };
    const add_tab = () => {
      const browser = { localName: "browser", innerWindowID: 10, messageManager: { sendAsyncMessage: (name: string, data: unknown) => sent_to_frames.push({ browser, name, data }) } };
      const tab = { browser };
      tabs.set(tab, tab);
      return { tab, browser };
    };
    const press = (event: FakeEvent) => {
      for (const listener of listeners.get("keydown") ?? []) listener(event);
      return event;
    };
    const close = () => {
      for (const listener of [...(listeners.get("unload") ?? [])]) listener(key_event("unload"));
    };
    return { win, load, add_tab, press, close, tab_moves, listener_count: (type: string) => listeners.get(type)?.size ?? 0 };
  };

  const report = (browser: unknown, data: unknown) => {
    for (const listener of message_listeners.get("desertfox-browser-module:report") ?? []) listener({ target: browser, data });
  };

  const set_pref = (value: boolean | string | undefined) => {
    if (value === undefined) prefs.delete("desertfox.browser_module.enabled");
    else prefs.set("desertfox.browser_module.enabled", value);
    pref_observers.forEach((observer) => observer());
  };

  const start_extension = ({ private_access = false } = {}) => {
    firefox.extension = { id: "desertfox@uhs-robert", privateBrowsingAllowed: private_access, bucket: new Map() };
    ready_listeners.forEach((listener) => listener("ready", firefox.extension!));
    return firefox.extension;
  };

  const write_state = (state: unknown) => firefox.extension!.bucket.set("desertfox_browser_module_state", holder_of(state));
  const hello = () => (firefox.extension?.bucket.get("desertfox_browser_module_hello") as { deserialize(): unknown } | undefined)?.deserialize();

  return Object.assign(firefox, { Services, make_window, report, set_pref, start_extension, write_state, hello, message_listener_count: () => [...message_listeners.values()].flat().length });
}
