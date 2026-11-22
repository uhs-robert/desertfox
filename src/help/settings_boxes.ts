// The Settings boxes that `settings_view.ts` draws empty and the form pages fill, in the order they mount. This order is not the page order: the site keys form mounts before Keys and the host banner after Themes. Keep it.

import type { Ask } from "../shared/messages/map.ts";
import type { Route } from "../shared/page/help_route.ts";
import { effective_settings } from "../shared/config.ts";
import { load_effective_config } from "../shared/config/config_load.ts";
import { QUICKMARK_STORAGE_KEY } from "../shared/config/storage_keys.ts";
import { touches_settings } from "../shared/storage_watch.ts";
import type { HelpModel } from "./model.ts";
import { mount_settings } from "./settings_page.ts";
import { mount_site_keys } from "./site_keys_page.ts";
import { mount_keys } from "./keys_page.ts";
import type { create_key_capture } from "./keys_page.ts";
import { mount_engines } from "./engines_page.ts";
import { mount_pairs } from "./pairs_page.ts";
import { ALIASES_KIND, QUICKMARKS_KIND } from "./pairs_model.ts";
import { mount_themes } from "./themes_page.ts";
import { mount_host_start } from "./host_start_page.ts";
import type { create_host_start_session } from "./host_start_model.ts";
import { mount_transfer } from "./transfer_page.ts";
import { mount_files } from "./files_page.ts";
import type { FilesSession } from "./files_model.ts";
import { NO_USER_CSS_HOLD } from "./user_css_gate.ts";
import type { UserCssHold } from "./user_css_gate.ts";

// `settings_view.ts` draws each box with its class, and the table finds it by the same class.
export const BOX_CLASS = {
  settings: "desertfox-settings",
  site_keys: "desertfox-site-keys",
  keys: "desertfox-keys",
  engines: "desertfox-engines",
  aliases: "desertfox-aliases",
  quickmarks: "desertfox-quickmarks",
  themes: "desertfox-themes",
  host_start: "desertfox-host-start",
  transfer: "desertfox-transfer",
  files: "desertfox-files",
} as const;

type OnChanged = Parameters<typeof mount_engines>[2];

// What the page keeps for its whole life.
export type BoxDeps = {
  send: Ask;
  on_changed: OnChanged;
  key_capture: ReturnType<typeof create_key_capture>;
  command_names: () => Promise<string[]>;
  files_session: FilesSession;
  host_start_session: ReturnType<typeof create_host_start_session>;
  open_hold: () => UserCssHold;
};

// What one render adds. `hold` is a fresh hold for an entry that asks for one, and the no-op hold for the others.
type BoxContext = BoxDeps & { route: Route; model: HelpModel; engines: string[]; hold: UserCssHold };

// `stop` ends the box's listeners before the next render. `redraw` draws it again when its session changes. `set_site` points the site keys form at another site.
export type BoxHandle = { stop?: () => void; redraw?: () => void; set_site?: (site: string) => void };

export type SettingsBox = {
  box_class: string;
  // Disposed and opened again at every render, even when the route has no such box: a view that is gone can then never release the hold of the one that replaced it.
  hold?: true;
  mount: (box: HTMLElement, context: BoxContext) => BoxHandle | void;
};

export const SETTINGS_BOXES: SettingsBox[] = [
  { box_class: BOX_CLASS.settings, mount: (box, c) => ({ stop: mount_settings(box, c.send, c.engines, c.on_changed, c.model.keys.reload, c.model.resolve_keys) }) },
  {
    box_class: BOX_CLASS.site_keys,
    mount: (box, c) => mount_site_keys(box, { send: c.send, read_rules: async () => effective_settings((await load_effective_config()).config.settings).site_rules }, c.route.site_keys, c.key_capture, c.on_changed),
  },
  { box_class: BOX_CLASS.keys, mount: (box, c) => ({ stop: mount_keys(box, { send: c.send, names: c.command_names }, c.key_capture, c.on_changed) }) },
  { box_class: BOX_CLASS.engines, mount: (box, c) => ({ stop: mount_engines(box, { send: c.send }, c.on_changed) }) },
  { box_class: BOX_CLASS.aliases, mount: (box, c) => ({ stop: mount_pairs(box, ALIASES_KIND, { send: c.send }, c.on_changed, touches_settings) }) },
  {
    // `M` writes the store without a publish, so the rows follow the store's key as well as the config.
    box_class: BOX_CLASS.quickmarks,
    mount: (box, c) => ({ stop: mount_pairs(box, QUICKMARKS_KIND, { send: c.send }, c.on_changed, (changes, area) => touches_settings(changes, area) || (area === "local" && QUICKMARK_STORAGE_KEY in changes)) }),
  },
  { box_class: BOX_CLASS.themes, mount: (box, c) => ({ stop: mount_themes(box, { send: c.send }, c.on_changed) }) },
  { box_class: BOX_CLASS.host_start, mount: (box, c) => ({ redraw: mount_host_start(box, c.host_start_session, c.send) }) },
  { box_class: BOX_CLASS.transfer, hold: true, mount: (box, c) => void mount_transfer(box, c.send, c.hold) },
  { box_class: BOX_CLASS.files, hold: true, mount: (box, c) => void mount_files(box, c.files_session, c.hold) },
];

// Keeps the handles of the mounted boxes and the holds the entries took. `entries` is a parameter so a test can pass a recording table.
export function create_settings_boxes(deps: BoxDeps, entries: SettingsBox[] = SETTINGS_BOXES) {
  let handles: BoxHandle[] = [];
  const holds = new Map<SettingsBox, UserCssHold>();

  return {
    // Run before the page draws again: the boxes the draw removes must stop listening first.
    stop_all(): void {
      for (const handle of handles) handle.stop?.();
      handles = [];
    },
    mount_all(route: Route, model: HelpModel, engines: string[]): void {
      for (const entry of entries) {
        const box = route.page === "settings" ? document.querySelector<HTMLElement>(`.${entry.box_class}`) : null;
        let hold = NO_USER_CSS_HOLD;
        if (entry.hold) {
          holds.get(entry)?.dispose();
          hold = deps.open_hold();
          holds.set(entry, hold);
        }
        if (!box) continue;
        const handle = entry.mount(box, { ...deps, route, model, engines, hold });
        if (!handle) continue;
        handles.push(handle);
        handle.redraw?.();
      }
    },
    // Draws again the boxes that follow a session, such as the host start banner.
    redraw(): void {
      for (const handle of handles) handle.redraw?.();
    },
    set_site(site: string): void {
      for (const handle of handles) handle.set_site?.(site);
    },
  };
}
