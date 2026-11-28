// The extension's end of the page keys of the browser module (browser_module/desertfox-page-keys.js): the heading list and pick of `sh` on a locked page, and the register text of `<C-r>` in a field.
// The module is a thin executor here. It lists the page's headings and scrolls to the one at an index. The extension keeps the matching and the typed text.

import type { ModuleArgs } from "../shared/browser_module_protocol.ts";
import { REGISTER_TEXT_CHARS } from "../shared/browser_module_protocol.ts";
import { parse_page_headings, pick_heading } from "../shared/browser_module_headings.ts";
import type { CheckedArgs } from "../shared/command.ts";
import { RuntimeRefusal } from "../shared/command.ts";
import type { HeadingItem, Outcome } from "../shared/messages/content.ts";
import { REGISTER_KEY } from "../shared/register_names.ts";
import type { CallResult } from "./browser_module_call.ts";
import type { RegisterStore } from "./register_store.ts";

// The command the module serves with no page. Its registry entry runs in the page, and the router asks `run_without_page` after the send to the page failed.
const HEADING_COMMAND_ID = "heading.go";

// The headings of the tab's page, or nothing when the module refuses or answers badly.
export const read_module_headings = async (call: (kind: string, args: ModuleArgs) => Promise<CallResult>, tab_id: number): Promise<HeadingItem[] | undefined> => {
  const read = await call("page_headings.read", { tab_id });
  return read.ok ? parse_page_headings(read.value) : undefined;
};

// `heading.go` for a tab with no page code: the list is read again, so the pick has the page as it is now, and the module scrolls to the index. Undefined for every other command.
export function create_run_without_page(call: (kind: string, args: ModuleArgs) => Promise<CallResult>) {
  return async (command_id: string, args: CheckedArgs, tab_id: number): Promise<Outcome | undefined> => {
    if (command_id !== HEADING_COMMAND_ID || typeof args["heading"] !== "string") return undefined;
    const rows = await read_module_headings(call, tab_id);
    if (rows === undefined) return { ok: false, message: "The headings of this page cannot be read" };
    let index: number;
    try {
      index = pick_heading(rows, args["heading"]);
    } catch (error) {
      if (error instanceof RuntimeRefusal) return { ok: false, message: error.message };
      throw error;
    }
    const went = await call("page_heading.go", { tab_id, index });
    return went.ok ? { ok: true } : { ok: false, message: went.error };
  };
}

export type RegisterReadDeps = {
  store: Pick<RegisterStore, "read">;
  // Whether the tab is private, which picks the area its registers live in. Undefined for a tab that is gone.
  is_private: (tab_id: number) => Promise<boolean | undefined>;
};

// Control and format characters go, except the newline and tab a pasted text keeps, then the cap. The module and the frame script clean again.
const cleaned_register_text = (text: string): string => [...text.replace(/[\p{Cc}\p{Cf}]/gu, (each) => (each === "\n" || each === "\t" ? each : ""))].slice(0, REGISTER_TEXT_CHARS).join("");

// The handler of the `register.read` kind: the text of one register for the tab that asked. The module is foreign input, so the name is checked here again and a macro or an empty register is a refusal. The tab's privacy comes from the tab, never from the request.
export function create_register_read(deps: RegisterReadDeps) {
  return async (args: ModuleArgs): Promise<string> => {
    const { tab_id, name } = args as { tab_id: number; name: string };
    if (!REGISTER_KEY.test(name)) throw new Error("not a register name");
    const is_private = await deps.is_private(tab_id);
    if (is_private === undefined) throw new Error("the tab is gone");
    const value = await deps.store.read(name, is_private);
    if (typeof value !== "string" || value === "") throw new Error("the register has no text");
    return cleaned_register_text(value);
  };
}
