// The on/off switch behind the toolbar popup and its shortcut. Browser access comes in as arguments, so tests run without a browser.

import { site_pattern } from "../shared/site/site_state.ts";
import { COMPILED_KEYMAP_VERSION } from "../shared/prefix_tree.ts";
import type { ToolbarAnswer, ToolbarRequest } from "../shared/messages/page.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import { DEFAULT_TOAST_ERROR_MS, DEFAULT_TOAST_MS } from "../shared/default_settings.ts";
import { best_effort, keep_chain } from "../shared/swallow.ts";

// The manifest `commands` entry that toggles. It is not a slot: no keymap chord reaches it, and it runs while DesertFox is off.
export const TOGGLE_COMMAND = "toggle_enabled";

export const ICON_ON = "icons/desertfox.svg";
export const ICON_OFF = "icons/desertfox-off.svg";

export type ToolbarLook = { path: string; title: string };

export const toolbar_look = (disabled: boolean): ToolbarLook =>
  disabled ? { path: ICON_OFF, title: "DesertFox (off)" } : { path: ICON_ON, title: "DesertFox" };

// What the background publishes in place of the keymap while off. The content script reads it like any tree: no key matches and the
// mode badge is hidden. Only `off` is read by name, so a lone keyup passes.
export const OFF_KEYMAP: CompiledKeymap = { format_version: COMPILED_KEYMAP_VERSION, modes: {}, off: true, mode_indicator: "off", which_key_delay_ms: 0, toast_ms: DEFAULT_TOAST_MS, toast_error_ms: DEFAULT_TOAST_ERROR_MS };

export type ToolbarDeps = {
  read_disabled: () => Promise<boolean>;
  write_disabled: (disabled: boolean) => Promise<void>;
  set_look: (look: ToolbarLook) => Promise<void>;
  // Compiles and stores the keymap again. It reads the flag, so it stores the empty keymap while off.
  republish: () => Promise<void>;
  tabs: () => Promise<{ tab_id: number; url: string | undefined }[]>;
  // A tab without a content script rejects. The caller treats that as nothing to do.
  set_tab_mode: (tab_id: number, mode: "normal") => Promise<unknown>;
};

export function create_toolbar(deps: ToolbarDeps) {
  // Every change runs here one at a time, so a popup click and the shortcut never read the same flag and write the same answer.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(step: () => Promise<T>): Promise<T> => {
    const run = queue.then(step);
    queue = keep_chain(run);
    return run;
  };

  // Open tabs keep the mode they are in, and the empty keymap alone does not end a hint, command line or insert mode.
  async function leave_modes(): Promise<void> {
    const tabs = await deps.tabs();
    await Promise.all(tabs.map((tab) => best_effort(deps.set_tab_mode(tab.tab_id, "normal"))));
  }

  async function apply(disabled: boolean): Promise<void> {
    const before = await deps.read_disabled();
    if (before === disabled) return;
    await deps.write_disabled(disabled);
    try {
      await deps.republish();
    } catch (error) {
      // A keymap that still says the old state under the new icon would be worse than the failure.
      await deps.write_disabled(before);
      throw error;
    }
    await deps.set_look(toolbar_look(disabled));
    // Turning on needs no step: the content script sees the stored tree change and enters ignore mode on an all-off rule.
    if (disabled) await leave_modes();
  }

  return {
    // Run at every background start: Firefox forgets the icon, and the flag is stored.
    sync_look: (): Promise<void> => enqueue(async () => deps.set_look(toolbar_look(await deps.read_disabled()))),
    set_disabled: (disabled: boolean): Promise<void> => enqueue(() => apply(disabled)),
    toggle: (): Promise<void> => enqueue(async () => apply(!(await deps.read_disabled()))),
  };
}

export type ToolbarMessageDeps = {
  toolbar: Pick<ReturnType<typeof create_toolbar>, "set_disabled">;
  // Writes the popup's row change for the page at `url` into settings.toml (`change_site_rule_in_file`), and gives back what became of the file as a note for the answer.
  change_site_rule: (url: string, action: "disable" | "enable") => Promise<string>;
  reload_config: () => Promise<{ config_dir: string; warnings: number }>;
};

const failure = (error: unknown): ToolbarAnswer => ({ ok: false, message: error instanceof Error ? error.message : String(error) });

// The popup's three writes. The request is checked here because a page script can send anything.
export async function answer_toolbar_request(request: ToolbarRequest, deps: ToolbarMessageDeps): Promise<ToolbarAnswer> {
  try {
    if (request.type === "toolbar_set_disabled") {
      if (typeof request.disabled !== "boolean") return { ok: false, message: "disabled must be true or false" };
      await deps.toolbar.set_disabled(request.disabled);
      return { ok: true, message: request.disabled ? "DesertFox is off" : "DesertFox is on" };
    }
    if (request.type === "toolbar_site") {
      const pattern = site_pattern(typeof request.url === "string" ? request.url : undefined);
      if (pattern === undefined) return { ok: false, message: "this page has no site to change" };
      if (request.action !== "disable" && request.action !== "enable") return { ok: false, message: "action must be disable or enable" };
      const note = await deps.change_site_rule(request.url as string, request.action);
      return { ok: true, message: `${request.action === "disable" ? "Disabled on this site" : "Enabled on this site"}${note}` };
    }
    if (request.type === "toolbar_reload_config") {
      const { config_dir, warnings } = await deps.reload_config();
      return { ok: true, message: `Reloaded ${config_dir}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}` };
    }
    return { ok: false, message: "unknown request" };
  } catch (error) {
    return failure(error);
  }
}
