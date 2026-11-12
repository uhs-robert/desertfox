import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { BLACK_HOLE_REGISTER } from "../shared/register_names.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";
import { browser_complete_items_deps, read_tabs } from "../background/complete_items.ts";
import type { ListedTab } from "../background/complete_items.ts";
import { browser_register_store, is_private_context } from "../background/register_store.ts";
import type { RegisterStore } from "../background/register_store.ts";
import { format_link_list, LIST_FORMATS } from "../content/link_list.ts";
import type { ListFormat } from "../content/link_list.ts";
import { read_strip_patterns } from "../content/strip_setting.ts";
import { strip_tracking } from "../content/strip_tracking.ts";
import { YANK_REGISTER_PARAM } from "./register_param.ts";

export type CopyTabsDeps = {
  // The tabs a line of this window lists: its own privacy only, its own window first, each window in tab order.
  tabs: (ctx: CommandContext, all_windows: boolean) => Promise<ListedTab[]>;
  is_private: (ctx: CommandContext) => Promise<boolean>;
  strip_patterns: () => Promise<readonly string[]>;
  write_clipboard: (text: string) => Promise<void>;
  store: RegisterStore;
  toast: (ctx: CommandContext, message: string) => Promise<void>;
};

const WEB_ADDRESS = /^(https?|ftp|file):/i;

const count_of = (count: number) => `${count} ${count === 1 ? "tab" : "tabs"}`;

// A blank line separates windows, so a pasted list keeps each window's tabs together.
function by_window(tabs: readonly ListedTab[]): ListedTab[][] {
  const windows = new Map<number, ListedTab[]>();
  for (const tab of tabs) windows.set(tab.window_id, [...(windows.get(tab.window_id) ?? []), tab]);
  return [...windows.values()];
}

export function make_copy_tabs_handler(deps: CopyTabsDeps) {
  return async (ctx: CommandContext, args: { scope: "window" | "all"; format: ListFormat; register?: string }): Promise<void> => {
    const register = args.register ?? "";
    const listed = await deps.tabs(ctx, args.scope === "all");
    const web_tabs = listed.filter((tab) => WEB_ADDRESS.test(tab.url));
    if (web_tabs.length === 0) throw new RuntimeRefusal("No web tabs to copy");
    if (register === BLACK_HOLE_REGISTER) return;
    const patterns = await deps.strip_patterns();
    const windows = by_window(web_tabs).map((tabs) => format_link_list(tabs.map((tab) => ({ url: strip_tracking(tab.url, patterns), text: tab.title })), args.format));
    const text = windows.join("\n\n");
    let clipboard_failed = false;
    await deps.write_clipboard(text).catch(() => void (clipboard_failed = true));
    // A private window's registers stay apart from the normal ones, as for every yank.
    await deps.store.yank(register, text, await deps.is_private(ctx));
    if (clipboard_failed) throw new RuntimeRefusal("Could not copy to the clipboard");
    const skipped = listed.length - web_tabs.length;
    await deps.toast(ctx, `Copied ${count_of(web_tabs.length)}${skipped > 0 ? `, skipped ${skipped} non-web ${skipped === 1 ? "tab" : "tabs"}` : ""}`);
  };
}

const handler = make_copy_tabs_handler({
  tabs: async (ctx, all_windows) => {
    if (ctx.window_id === undefined) throw new RuntimeRefusal("No window");
    const incognito = await is_private_context(ctx);
    return read_tabs(browser_complete_items_deps.query_tabs, { window_id: ctx.window_id, incognito }, all_windows);
  },
  is_private: is_private_context,
  strip_patterns: read_strip_patterns,
  write_clipboard: (text) => navigator.clipboard.writeText(text),
  store: browser_register_store,
  toast: (ctx, message) => show_toast_on_tab(ctx, "copy_tabs", message, "success"),
});

define("copy.tabs", {
  name: "copytabs",
  label: "Copy tabs",
  intent: "Copy the open tabs as a list. The clipboard gets one line per web tab of this window or all windows, as Markdown, Org, plain addresses or titles.",
  params: [
    {
      name: "scope",
      type: "enum",
      values: ["window", "all"],
      default: "window",
      short: { all: "a" },
      value_labels: { all: "of all windows" },
      description: { all: "Copy every window, with a blank line between them." },
    },
    {
      name: "format",
      type: "enum",
      values: LIST_FORMATS,
      default: "markdown",
      short: { plain: "u", org: "o", title: "t" },
      value_labels: { plain: "as plain addresses", org: "as an Org list", title: "as page titles" },
      description: { plain: "Copy the addresses, one per line.", org: "Copy an Org list.", title: "Copy the titles, one per line." },
    },
    YANK_REGISTER_PARAM,
  ],
  bridge: false,
  runs_in: "background",
  run: (ctx, args) => handler(ctx, args as Parameters<typeof handler>[1]),
});
