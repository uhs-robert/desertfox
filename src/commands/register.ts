import { RuntimeRefusal } from "../shared/command.ts";
import type { CommandContext } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { REGISTER_NAME_PATTERN } from "../shared/register_names.ts";
import { show_toast_on_tab } from "../background/browser_deps.ts";
import { browser_register_store, describe_value, is_private_context } from "../background/register_store.ts";
import type { RegisterStore } from "../background/register_store.ts";
import type { ToastKind } from "../shared/messages.ts";

export type RegisterCommandDeps = {
  store: RegisterStore;
  is_private: (ctx: CommandContext) => Promise<boolean>;
  toast: (ctx: CommandContext, kind: ToastKind, message: string) => Promise<void>;
};

const LONG_PREVIEW_CHARS = 200;

export function make_register_handlers(deps: RegisterCommandDeps) {
  return {
    // With no name, one toast names every register that holds something. With a name, it shows that register.
    list: async (ctx: CommandContext, args: { name?: string }) => {
      const is_private = await deps.is_private(ctx);
      const name = args.name?.trim();
      if (name === undefined || name === "") {
        const rows = await deps.store.items(is_private);
        if (rows.length === 0) throw new RuntimeRefusal("No register holds anything");
        return deps.toast(ctx, "info", rows.map((row) => `${row.name} ${row.description}`).join("   "));
      }
      const value = await deps.store.read(name, is_private);
      if (value === undefined || value === "") throw new RuntimeRefusal(`Register ${name} is empty`);
      const line = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, LONG_PREVIEW_CHARS) : describe_value(value);
      return deps.toast(ctx, "info", `${name} ${line}`);
    },
  };
}

const handlers = make_register_handlers({
  store: browser_register_store,
  is_private: is_private_context,
  toast: (ctx, kind, message) => show_toast_on_tab(ctx, "register", message, kind),
});

define("register.list", {
  name: "registers",
  label: "List registers",
  intent: "List registers, or show one in full. A macro shows its step count.",
  params: [{ name: "name", type: "string", rest: true, main: true, optional: true, values: { from: "registers" }, pattern: REGISTER_NAME_PATTERN, description: "Show this register in full." }],
  runs_in: "background",
  repeatable: false,
  run: (ctx, args) => handlers.list(ctx, args as { name?: string }),
});
