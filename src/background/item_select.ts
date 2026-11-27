// The `item_select` setting set to `arrows`: a site that keeps its own selection (a file list where Enter opens the selected file) moves it with its own arrow keys. The page's item tree is rewritten when the page asks for its keymap, so item.js and content.js carry nothing for it.

import type { CommandDef } from "../shared/command.ts";
import type { ItemSelectKeys, LeafStep } from "../shared/prefix_tree.ts";
import { check_args } from "../shared/registry/check_args.ts";
import type { EnumSources } from "../shared/registry/check_args.ts";

const ARROWS = { down: { key: "ArrowDown", key_code: 40 }, up: { key: "ArrowUp", key_code: 38 }, left: { key: "ArrowLeft", key_code: 37 }, right: { key: "ArrowRight", key_code: 39 } } as const;

// The arrow steps come from the registry through the one validator, so their defaults, side and bundle are never copied by hand. A count sends the arrow that many times, as `page.send_key` says.
export function item_select_keys(get_command: (id: string) => Pick<CommandDef, "id" | "params" | "runs_in" | "count" | "bundle"> | undefined, enum_sources: EnumSources): ItemSelectKeys | undefined {
  const command = get_command("page.send_key");
  if (!command) return undefined;
  const steps = (Object.keys(ARROWS) as (keyof typeof ARROWS)[]).map((direction) => {
    const result = check_args(command, ARROWS[direction], enum_sources);
    const step: LeafStep = { invocation: { id: "page.send_key", args: result.ok ? result.args : {} }, runs_in: command.runs_in, count_rule: command.count ?? "ignore", ...(command.bundle && { bundle: command.bundle }) };
    return result.ok ? ([direction, step] as const) : undefined;
  });
  return steps.every((entry) => entry !== undefined) ? (Object.fromEntries(steps) as ItemSelectKeys) : undefined;
}

export { with_item_select } from "../shared/site/item_select_rewrite.ts";
