// Which normal-mode keys DesertFox runs on a locked page through the browser module, where no content script can run (see docs/design/browser_module.md, "Keys on locked pages").
// The set is derived from the registry, never listed by hand: a command that runs in the background and needs no page, minus the deny list. The background prunes the compiled normal tree to the leaves of that set for the module's state, and checks each run request against the full tree again.

import type { CommandDef } from "./command.ts";
import type { BoundInvocation } from "./invocation.ts";
import type { NativeLeaf, PageHintAction, ScopeNode, ScopeTree } from "./browser_module_protocol.ts";
import { check_module_args, is_module_command_id, MAX_COUNT, MAX_SEQUENCE_KEYS } from "./browser_module_protocol.ts";
import { create_matcher } from "./keys/matcher.ts";
import { COMPILED_KEYMAP_VERSION, current_keymap } from "./prefix_tree.ts";
import type { CompiledKeymap, LeafStep, TreeBranch, TreeLeaf, TreeNode } from "./prefix_tree.ts";

// Background commands that still make no sense with no DesertFox page: a mode needs a page to hold it, and `frame.exit` a frame to leave. `macro.record` stays out because a page swaps its key for `macro.stop` while a macro records, and the stored tree has no such swap.
const DENIED_IDS: readonly string[] = ["media.act", "frame.exit", "macro.record"];
// `sidebar.` commands run only in the module, in the sidebar, and refuse in the extension.
const DENIED_GROUPS: readonly string[] = ["mode.", "sidebar."];

export function runs_on_locked_pages(command: Pick<CommandDef, "id" | "runs_in" | "needs">): boolean {
  if (command.runs_in !== "background" || command.needs?.includes("content")) return false;
  return !DENIED_IDS.includes(command.id) && !DENIED_GROUPS.some((group) => command.id.startsWith(group));
}

export const locked_page_command_ids = (commands: Iterable<CommandDef>): Set<string> => new Set([...commands].filter(runs_on_locked_pages).map((command) => command.id));

// Checks a command's args through the one validator and gives them back with every default filled, or undefined when the registry refuses them.
export type CheckCommandArgs = (id: string, args: Record<string, unknown> | undefined) => Record<string, unknown> | undefined;

// A guard asks about the page's focus or content, which a locked page cannot answer.
const has_guard = (leaf: TreeLeaf): boolean => leaf.when_focus !== undefined || leaf.when_present !== undefined || leaf.otherwise !== undefined || leaf.otherwise_page !== undefined;

// Every step is a command of the set, so the router runs the whole leaf with no page. A step that prompts opens the address bar (`address_bar.open`), which needs no page either.
export const forwards_leaf = (leaf: TreeLeaf, allowed: ReadonlySet<string>): boolean => !has_guard(leaf) && leaf.steps.length > 0 && leaf.steps.every((step) => step.leave !== true && step.runs_in === "background" && allowed.has(step.invocation.id));

// The bare command line key (`:`): the background opens the line over the locked page as a panel, else the address bar (`background/cmdline_panel.ts`). A line with typed text is left out, because its commands mostly need a page.
export const opens_line_leaf = (leaf: TreeLeaf): boolean => {
  const step = leaf.steps.length === 1 ? leaf.steps[0] : undefined;
  const text = step?.invocation.args?.["text"];
  return !has_guard(leaf) && step?.invocation.id === "cmdline.open" && step.capture === undefined && step.register === undefined && (text === undefined || text === "");
};

// A leaf of one step that the module runs itself (the protocol's command list), with its args filled and checked by the registry.
export function native_leaf(leaf: TreeLeaf, check_args: CheckCommandArgs): NativeLeaf | undefined {
  if (has_guard(leaf) || leaf.steps.length !== 1) return undefined;
  const { invocation, capture, register, count_rule } = leaf.steps[0]!;
  if (capture !== undefined || register !== undefined || invocation.prompt !== undefined || !is_module_command_id(invocation.id)) return undefined;
  const filled = check_args(invocation.id, invocation.args);
  const args = filled && check_module_args(invocation.id, filled);
  if (!args?.ok) return undefined;
  return { native: invocation.id, args: args.value, ...(count_rule !== "ignore" && { count_rule }) };
}

// A leaf that starts hints, which run only in DesertFox's page code.
export const is_hint_leaf = (leaf: TreeLeaf): boolean => leaf.steps.some((step) => step.invocation.id === "hint.run");

// A forward leaf after which the line opens: the bare `:`, or a key whose command prompts for a value (`o`).
const prompts_or_opens_line = (leaf: TreeLeaf): boolean => opens_line_leaf(leaf) || leaf.steps.some((step) => step.invocation.prompt !== undefined);

type Pruning = { allowed: ReadonlySet<string>; check_args: CheckCommandArgs; line_keys: string[]; hint_keys: string[] };

function prune_node(node: TreeNode, depth: number, path: readonly string[], pruning: Pruning): ScopeNode | undefined {
  if (node.kind === "leaf") {
    const native = native_leaf(node, pruning.check_args);
    if (native) return native;
    if (!forwards_leaf(node, pruning.allowed) && !opens_line_leaf(node)) {
      if (is_hint_leaf(node) && !path.includes("")) pruning.hint_keys.push(path.join(" "));
      return undefined;
    }
    // A path through a capture key (the empty token) names no keys the module could match it by.
    if (prompts_or_opens_line(node) && !path.includes("")) pruning.line_keys.push(path.join(" "));
    return "forward";
  }
  if (depth >= MAX_SEQUENCE_KEYS) return undefined;
  const children = prune_children(node, depth + 1, path, pruning);
  return Object.keys(children).length > 0 ? { children } : undefined;
}

function prune_children(branch: TreeBranch, depth: number, path: readonly string[], pruning: Pruning): Record<string, ScopeNode> {
  return Object.fromEntries(Object.entries(branch.children).flatMap(([token, child]) => {
    const kept = prune_node(child, depth, [...path, token], pruning);
    return kept === undefined ? [] : [[token, kept]];
  }));
}

// The normal tree with only the leaves a locked page can run. A key that leads only to other leaves is left out, so the page or Firefox keeps it. The bare command line key stays, as a forward leaf. Site rules do not apply: a locked page matches none.
export function scope_tree_of(keymap: CompiledKeymap | undefined, allowed: ReadonlySet<string>, check_args: CheckCommandArgs): ScopeTree {
  // A tree of an older format has another shape, so it gives no keys until the background recompiles.
  const root = current_keymap(keymap)?.modes.normal;
  const pruning: Pruning = { allowed, check_args, line_keys: [], hint_keys: [] };
  const children = root ? prune_children(root, 1, [], pruning) : {};
  return { children, ...(pruning.line_keys.length > 0 && { line_keys: pruning.line_keys }), ...(pruning.hint_keys.length > 0 && { hint_keys: pruning.hint_keys }) };
}

// The scope tree in the shape `create_matcher` walks, for the module's bundle. A leaf keeps its scope node in `scope`, and a forward leaf has no steps.
export type MatcherLeaf = TreeLeaf & { scope: "forward" | NativeLeaf };
export function matcher_keymap_of(tree: ScopeTree): CompiledKeymap {
  const branch = (node: ScopeTree): TreeBranch => ({ kind: "branch", children: Object.fromEntries(Object.entries(node.children).map(([token, child]) => [token, typeof child === "string" || "native" in child ? ({ kind: "leaf", steps: [], scope: child } satisfies MatcherLeaf) : branch(child)])) });
  return { format_version: COMPILED_KEYMAP_VERSION, modes: { normal: branch(tree) }, mode_indicator: "off", which_key_delay_ms: 0, toast_ms: 0, toast_error_ms: 0 };
}

// The steps of a leaf with the typed count, as the content script sends them (`counted_invocations` in content/run_content.ts). The router applies each step's count rule.
export const counted_steps = (steps: readonly LeafStep[], count: number | undefined): BoundInvocation[] =>
  steps.map(({ invocation, count_rule }) => (count === undefined || count_rule === "ignore" ? invocation : { ...invocation, count }));

// One normalized key token, as the protocol's key rows take it.
const KEY_TOKEN = /^[^\s\p{Cc}\p{Cf}]{1,24}$/u;

// `hint` marks a refused hint key, so the background can say why hints do not run on the page.
export type ResolvedRun = { ok: true; leaf: TreeLeaf; count: number | undefined } | { ok: false; problem: string; shown?: true; hint?: true };

// Matches a run request's keys against the full normal tree, never the module's copy, so a stale or forged copy cannot run a key the keymap does not bind there now.
// The keys must reach a leaf with the last token, with no count, register or hold typed among them, and the leaf must run with no page. A problem marked `shown` is one the user caused and is told about.
export function resolve_run(keymap: CompiledKeymap | undefined, keys_text: string, count: number, allowed: ReadonlySet<string>): ResolvedRun {
  const keys = keys_text.split(" ");
  if (keys.length > MAX_SEQUENCE_KEYS || !keys.every((key) => KEY_TOKEN.test(key))) return { ok: false, problem: "the keys are not a key sequence" };
  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) return { ok: false, problem: "the count is out of range" };
  const current = current_keymap(keymap);
  if (!current?.modes.normal) return { ok: false, problem: "DesertFox has no keymap yet", shown: true };
  const matcher = create_matcher(current);
  const label = keys.join("");
  for (const [index, token] of keys.entries()) {
    const result = matcher.feed("normal", token);
    const last = index === keys.length - 1;
    if (result.kind_ === "pending" && !last && result.count === undefined && result.register_keys_ === undefined && result.held_ === undefined) continue;
    if (result.kind_ !== "match" || !last || result.count !== undefined || result.held_ !== undefined || result.keys?.length !== keys.length) return { ok: false, problem: `${label} is not a key DesertFox runs here`, shown: true };
    if (!forwards_leaf(result.leaf, allowed) && !opens_line_leaf(result.leaf)) return { ok: false, problem: `${label} needs a page DesertFox runs on`, shown: true, ...(is_hint_leaf(result.leaf) && { hint: true as const }) };
    return { ok: true, leaf: result.leaf, count: count === 0 ? undefined : count };
  }
  return { ok: false, problem: `${label} is not a key DesertFox runs here`, shown: true };
}

// The action of a page hint session (see `page_hints.want`) for the hint key the module matched on one of Firefox's own pages, matched again against the full normal tree.
// Only a lone `hint.run` step maps: a plain click, a tab or a background tab, or a copy of a link's address. Any other action, filter or arg value needs DesertFox's page code, so it is refused.
export type PageHintChoice = { ok: true; action: PageHintAction } | { ok: false; problem: string };
const PAGE_HINT_REFUSAL = "This hint does not run on this page";
const ANY_ELEMENT_FILTERS: readonly unknown[] = [undefined, "all", "clickable"];
const LINK_FILTERS: readonly unknown[] = [...ANY_ELEMENT_FILTERS, "links"];
// The registry fills every hint arg, so these are the values that change nothing on such a page. `frames` stays free: the page's own frames get no labels.
const PLAIN_HINT_ARGS: Record<string, readonly unknown[]> = { text: [undefined, ""], rapid: [undefined, false], register: [undefined, ""] };

export function page_hint_action_of(keymap: CompiledKeymap | undefined, keys_text: string): PageHintChoice {
  const keys = keys_text.split(" ");
  if (keys.length > MAX_SEQUENCE_KEYS || !keys.every((key) => KEY_TOKEN.test(key))) return { ok: false, problem: "the keys are not a key sequence" };
  const current = current_keymap(keymap);
  if (!current?.modes.normal) return { ok: false, problem: "DesertFox has no keymap yet" };
  const matcher = create_matcher(current);
  let leaf: TreeLeaf | undefined;
  for (const [index, token] of keys.entries()) {
    const result = matcher.feed("normal", token);
    const last = index === keys.length - 1;
    if (result.kind_ === "pending" && !last && result.count === undefined && result.register_keys_ === undefined && result.held_ === undefined) continue;
    if (result.kind_ === "match" && last && result.count === undefined && result.held_ === undefined && result.keys?.length === keys.length) leaf = result.leaf;
    break;
  }
  const step = leaf && !has_guard(leaf) && leaf.steps.length === 1 ? leaf.steps[0] : undefined;
  if (!step || step.invocation.id !== "hint.run" || step.capture !== undefined || step.invocation.prompt !== undefined) return { ok: false, problem: PAGE_HINT_REFUSAL };
  const { action = "here", filter, frames: _frames, ...rest } = step.invocation.args ?? {};
  if (!Object.entries(rest).every(([name, value]) => Object.hasOwn(PLAIN_HINT_ARGS, name) && PLAIN_HINT_ARGS[name]!.includes(value))) return { ok: false, problem: PAGE_HINT_REFUSAL };
  if (action === "here" && ANY_ELEMENT_FILTERS.includes(filter)) return { ok: true, action: "follow" };
  if ((action === "tab" || action === "background") && LINK_FILTERS.includes(filter)) return { ok: true, action };
  if (action === "copy" && LINK_FILTERS.includes(filter)) return { ok: true, action: "yank" };
  return { ok: false, problem: PAGE_HINT_REFUSAL };
}
