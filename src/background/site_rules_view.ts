// What the site table does to one page: each row that fits the page address, in table order, with the columns it sets and the keys it changes. Built from the stored keymap's rows. Which row decides a column comes from `resolve_site_columns`, and whether a key change reaches the page comes from `normal_tree_for`, the step the keys use.

import type { CompiledKeymap, SiteBind, SiteRule, TreeLeaf, TreeNode } from "../shared/prefix_tree.ts";
import { resolve_site_columns } from "../shared/match_pattern.ts";
import { normal_tree_for, site_columns_for, site_rules_matching, type PageSiteColumns } from "./page_keymap.ts";

// One column a row sets, shown as text. `shadowed` means an earlier matching row already decides it.
export type RuleColumn = { name: string; value: string; shadowed: boolean };

// One key a row changes. `mode` names the site mode a bind belongs to. `replaces` is what the key does in the keymap without the row, absent when the key is free there. `dead` is why the change does not reach the page, absent when it does.
export type KeyChange = { keys: string; action: string; mode?: string; replaces?: string; dead?: string };

export type SiteRuleRowView = { origin: SiteRule["origin"]; name?: string; site: string; columns: RuleColumn[]; changes: KeyChange[] };

export type SiteRulesView = { address: string; rows: SiteRuleRowView[] };

const KEY_RULE_NAMES = ["pass", "only"] as const;

const leaf_text = (leaf: TreeLeaf): string => leaf.label ?? leaf.intent ?? leaf.steps.map((step) => step.invocation.id).join(", ");

// The keymap's own meaning of a key sequence: a binding's label, a group's name, or nothing.
function keymap_meaning(normal: TreeNode | undefined, tokens: readonly string[]): string | undefined {
  let node: TreeNode | undefined = normal;
  for (const token of tokens) node = node?.kind === "branch" ? node.children[token] : undefined;
  if (node === undefined) return undefined;
  return node.kind === "leaf" ? leaf_text(node) : `keys starting with ${tokens.join("")}`;
}

const value_text = (value: unknown): string => (typeof value === "string" ? value : Array.isArray(value) ? value.join(", ") : JSON.stringify(value));

// What the rows before this one already decide. Column by column the first row wins, so a column the earlier rows set is shadowed here.
function shadowing(earlier: PageSiteColumns) {
  return {
    off: earlier.off !== undefined,
    keys: earlier.keys !== undefined,
    bind: (key: string) => earlier.bind !== undefined && Object.hasOwn(earlier.bind, key),
    mode: (name: string) => earlier.modes !== undefined && Object.hasOwn(earlier.modes, name),
    value: (name: string) => Object.hasOwn(earlier.values, name),
  };
}

const EARLIER_ROW = "an earlier row decides it";

// The page as the keys see it, built by the step that builds the page's own tree.
type PageState = { columns: PageSiteColumns; all_off: boolean; tree: TreeNode | undefined };

function page_state(keymap: CompiledKeymap | undefined, address: string): PageState {
  const columns = site_columns_for(keymap, [address]);
  const page = normal_tree_for(keymap?.modes.normal, columns);
  return { columns, all_off: page.all_off, tree: page.tree };
}

function node_at(root: TreeNode | undefined, tokens: readonly string[]): TreeNode | undefined {
  let node = root;
  for (const token of tokens) node = node?.kind === "branch" ? node.children[token] : undefined;
  return node;
}

// Why a normal bind of this row is not what the page runs for its key, or undefined when it is.
function dead_bind(key: string, { tokens, leaf }: SiteBind, earlier: boolean, page: PageState): string | undefined {
  if (page.all_off) return "off for this page";
  if (earlier) return EARLIER_ROW;
  if (node_at(page.tree, tokens) === leaf) return undefined;
  const shorter = Object.values(page.columns.bind ?? {}).find((other) => other.tokens.length < tokens.length && other.tokens.every((token, index) => tokens[index] === token));
  if (shorter) return `${shorter.tokens.join("")} is a complete bind and hides longer keys under it`;
  if (page.columns.keys !== undefined) return "pass" in page.columns.keys ? "freed by pass" : "dropped by only";
  return `${key} is replaced by another bind`;
}

function bind_changes(binds: Readonly<Record<string, SiteBind>> | undefined, normal: TreeNode | undefined, dead: (key: string, bind: SiteBind) => string | undefined, mode?: string): KeyChange[] {
  return Object.entries(binds ?? {}).map(([key, bind]) => {
    const replaces = keymap_meaning(normal, bind.tokens);
    const reason = dead(key, bind);
    return { keys: bind.tokens.join(""), action: leaf_text(bind.leaf), ...(mode === undefined ? {} : { mode }), ...(replaces === undefined ? {} : { replaces }), ...(reason === undefined ? {} : { dead: reason }) };
  });
}

function row_view(rule: SiteRule, earlier: PageSiteColumns, page: PageState, normal: TreeNode | undefined): SiteRuleRowView {
  const shadowed = shadowing(earlier);
  const columns: RuleColumn[] = [];
  const changes: KeyChange[] = [];
  if (rule.off !== undefined) columns.push({ name: "off", value: String(rule.off), shadowed: shadowed.off });
  for (const name of KEY_RULE_NAMES) {
    const sequences = rule.keys && name in rule.keys ? (rule.keys as Record<string, string[][]>)[name]! : undefined;
    if (sequences === undefined) continue;
    columns.push({ name, value: sequences.map((tokens) => tokens.join("")).join(" "), shadowed: shadowed.keys });
    const dead = page.all_off ? "off for this page" : shadowed.keys ? EARLIER_ROW : undefined;
    changes.push(...sequences.map((tokens): KeyChange => {
      // Under `only` the kept key changes nothing itself: the rest go to the page.
      const replaces = name === "pass" ? keymap_meaning(normal, tokens) : undefined;
      return { keys: tokens.join(""), action: name === "pass" ? "goes to the page" : "stays a DesertFox key", ...(replaces === undefined ? {} : { replaces }), ...(dead === undefined ? {} : { dead }) };
    }));
  }
  for (const [name, value] of Object.entries(rule.values ?? {})) columns.push({ name, value: value_text(value), shadowed: shadowed.value(name) });
  changes.push(...bind_changes(rule.bind, normal, (key, bind) => dead_bind(key, bind, shadowed.bind(key), page)));
  for (const [name, mode] of Object.entries(rule.modes ?? {})) {
    columns.push({ name: `mode ${name}`, value: mode.label, shadowed: shadowed.mode(name) });
    changes.push(...bind_changes(mode.bind, normal, () => (page.all_off ? "off for this page" : shadowed.mode(name) ? EARLIER_ROW : undefined), name));
  }
  return { origin: rule.origin, ...(rule.origin === "default" ? { name: rule.name } : {}), site: rule.site, columns, changes };
}

// The rows that fit `address`, in table order. A keymap with no rows, or none that fit, gives an empty list.
export function site_rules_view(keymap: CompiledKeymap | undefined, address: string): SiteRulesView {
  const matching = site_rules_matching(keymap, [address]);
  const normal = keymap?.modes.normal;
  const page = page_state(keymap, address);
  return { address, rows: matching.map((rule, index) => row_view(rule, resolve_site_columns(matching.slice(0, index)) as PageSiteColumns, page, normal)) };
}
