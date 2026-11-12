import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { show_toast_on_tab, send_to_tab } from "../background/browser_deps.ts";
import { browser_mark_store } from "../background/mark_store.ts";
import type { MarkClearScope } from "../background/mark_store.ts";
import { is_private_context } from "../background/register_store.ts";
import { MARK_ADD_KEY } from "../shared/mark_names.ts";
import { listed_marks } from "../shared/mark_text.ts";
import type { MarkItem, ToastKind } from "../shared/messages.ts";
import { define } from "../shared/registry/builtin.ts";
import { current_tab_url } from "./open_target.ts";

export type MarkListDeps = {
  // The marks of the page the command ran on, then the global ones. Includes `'`, which the list leaves out.
  items: (ctx: CommandContext) => Promise<MarkItem[]>;
  // Runs `mark.jump` in the top frame of the command's tab, as a fresh jump: it carries no arrival number, so it never takes a waiting arrival.
  jump: (ctx: CommandContext, key: string) => Promise<void>;
  remove: (ctx: CommandContext, key: string) => Promise<void>;
  clear: (ctx: CommandContext, scope: MarkClearScope) => Promise<void>;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
};

export function make_mark_list_handlers(deps: MarkListDeps) {
  return {
    // Scrolls to the mark, or brings up the tab of a global mark. The command line list is the overview.
    list: async (ctx: CommandContext, args: { mark: string }) => {
      const key = args.mark.trim();
      if (!listed_marks(await deps.items(ctx)).some((item) => item.key === key)) throw new RuntimeRefusal(`No mark ${key}`);
      await deps.jump(ctx, key);
    },
    delete: async (ctx: CommandContext, args: { mark: string }) => {
      await deps.remove(ctx, args.mark.trim());
      await deps.toast(ctx, "success", `Mark ${args.mark.trim()} deleted`);
    },
    clear: async (ctx: CommandContext, args: { scope: MarkClearScope }) => {
      await deps.clear(ctx, args.scope);
      await deps.toast(ctx, "success", args.scope === "all" ? "All marks cleared" : "Marks of this page and the global marks cleared");
    },
  };
}

export const browser_mark_list_deps: MarkListDeps = {
  items: async (ctx) => browser_mark_store.items(await current_tab_url(ctx), await is_private_context(ctx)),
  jump: async (ctx, key) => {
    if (ctx.tab_id === undefined) throw new RuntimeRefusal("No tab to jump in");
    const reply = (await send_to_tab(ctx.tab_id, { type: "run_in_content", invocations: [{ id: "mark.jump", args: { key }, bundle: "page" }] }, 0)) as { ok?: boolean; message?: string } | undefined;
    if (reply?.ok === false) throw new RuntimeRefusal(reply.message ?? "Mark jump failed");
  },
  remove: async (ctx, key) => browser_mark_store.remove(key, await current_tab_url(ctx), await is_private_context(ctx)),
  clear: async (ctx, scope) => browser_mark_store.clear(scope, await current_tab_url(ctx), await is_private_context(ctx)),
  toast: (ctx, kind, message) => show_toast_on_tab(ctx, "mark", message, kind),
};

const handlers = make_mark_list_handlers(browser_mark_list_deps);

const MARK_PARAM_NAME = "mark";

define("mark.list", {
  name: "marks",
  label: "List marks",
  intent: "Pick a mark from the list and jump to it.",
  params: [{ name: MARK_PARAM_NAME, type: "string", rest: true, main: true, values: { from: "marks" }, pattern: MARK_ADD_KEY.source, description: "Jump to this mark, a-z or A-Z." }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.list(ctx, args as { mark: string }),
});

define("mark.delete", {
  label: "Delete mark",
  intent: "Delete a mark of this page, or a global mark.",
  params: [{ name: MARK_PARAM_NAME, type: "string", rest: true, main: true, values: { from: "marks" }, pattern: MARK_ADD_KEY.source, description: "Delete this mark, a-z or A-Z." }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.delete(ctx, args as { mark: string }),
});

// No default key and no confirmation: typing the command is the confirmation. Not repeatable, so `.` never replays `all`.
define("mark.clear", {
  label: "Clear marks",
  intent: "Clear this page's marks and the global marks, or every mark.",
  params: [{ name: "scope", type: "enum", values: ["page", "all"], description: { page: "Clear this page's marks and the global marks.", all: "Clear every page's marks and the global marks." } }],
  bridge: false,
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.clear(ctx, args as { scope: MarkClearScope }),
});
