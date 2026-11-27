// The background end of keys on a locked page: the module's `run` requests, and the address bar that stands in for the command line there (see docs/design/browser_module.md, "Keys on locked pages").
// A run request is foreign input from chrome code. Its keys are matched again against the stored keymap, and only a leaf of the locked-page set runs, in the active tab.

import type { ModuleArgs } from "../shared/browser_module_protocol.ts";
import { counted_steps, opens_line_leaf, resolve_run } from "../shared/browser_module_scope.ts";
import type { Outcome, Refusal, RunResponse } from "../shared/messages/index.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import type { RouteRequest } from "./router.ts";
import type { CallResult } from "./browser_module_call.ts";
import { runs_page_code } from "./browser_module_rpc.ts";
import { warn_and_go } from "../shared/swallow.ts";

export type ModuleRunDeps = {
  read_keymap: () => Promise<CompiledKeymap | undefined>;
  locked_commands: ReadonlySet<string>;
  run: (request: RouteRequest) => Promise<RunResponse>;
  // With no tab, a refusal shows as a desktop notification.
  show_refusal: (tab_id: undefined, refusal: Refusal) => Promise<unknown>;
  // The command line over the active tab, for the bare `:`: the panel, else the address bar.
  open_line: () => Promise<unknown>;
  // The active tab's address and whether `browser_module_pages` is on, for the reason a hint key gives.
  active_url: () => Promise<string | undefined>;
  pages_on: () => Promise<boolean>;
};

// The module sends a hint key only from the PDF viewer, Reader View or an about: page, and only the first one per document. The PDF viewer shows the PDF's own address.
export function hint_refusal_text(url: string | undefined, pages_on: boolean): string {
  return url !== undefined && runs_page_code(url) && !pages_on ? "Hints here need :set browser_module_pages true" : "Hints do not run on this page";
}

const REFUSAL_ID = "browser_module.run";
const HANDED_TO_ADDRESS_BAR: Outcome = { ok: true, cancelled: true };

// The handler of the `run` kind. It settles when the router has answered, and throws for a refusal, so the module's reply says the keys did not run.
export function create_module_run(deps: ModuleRunDeps) {
  const refuse = async (message: string, shown: boolean): Promise<never> => {
    if (shown) await deps.show_refusal(undefined, { id: REFUSAL_ID, message });
    throw new Error(message);
  };
  return async (args: ModuleArgs): Promise<void> => {
    // The kind row checked the shapes: `keys` is text and `count` a whole number.
    const { keys, count } = args as { keys: string; count: number };
    const resolved = resolve_run(await deps.read_keymap(), keys, count, deps.locked_commands);
    if (!resolved.ok && resolved.hint) return refuse(hint_refusal_text(await deps.active_url(), await deps.pages_on()), true);
    if (!resolved.ok) return refuse(resolved.problem, resolved.shown === true);
    if (opens_line_leaf(resolved.leaf)) {
      await deps.open_line();
      return;
    }
    // No sender tab: the router runs the binding in the active tab, so a module cannot aim it at another one. The router shows its own refusals, a count over a step's `repeat_limit` among them.
    const response = await deps.run({ invocations: counted_steps(resolved.leaf.steps, resolved.count), mode: "normal", may_prompt: true });
    if (!response.ok) throw new Error(response.refusal.message);
  };
}

// `open_cmdline` for the router: a tab with no content script opens the command line through the module instead, with the printed command typed in.
// DesertFox's own line in a panel over the tab comes first. When the module refuses it or has no panel, the address bar takes it, after `df `. A tab with a content script keeps the send's own failure.
export const with_address_bar = (
  open_in_page: (tab_id: number, frame_id: number, text: string) => Promise<unknown>,
  has_content_script: (tab_id: number) => Promise<boolean>,
  open_panel: (tab_id: number, text: string) => Promise<boolean>,
  call: (kind: string, args: ModuleArgs) => Promise<CallResult>,
) =>
  async (tab_id: number, frame_id: number, text: string): Promise<unknown> => {
    try {
      return await open_in_page(tab_id, frame_id, text);
    } catch (error) {
      if (await has_content_script(tab_id)) throw error;
      // A panel that broke on our side still leaves the address bar.
      if (!(await open_panel(tab_id, text).catch(warn_and_go("open_panel", false)))) {
        const opened = await call("address_bar.open", { text, tab_id });
        if (!opened.ok) throw error;
      }
      // The panel and the bar run the command themselves on Enter and never answer here, so the binding ends as a line the user left does: its later steps must not run while the user still edits.
      return HANDED_TO_ADDRESS_BAR;
    }
  };
