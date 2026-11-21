// The `tree` bundle: `page.tree`, which moves and folds through nested items (the comments of a thread) by their depth. Loaded on the first press.

import { RuntimeRefusal } from "../../shared/command.ts";
import { refused_as } from "../../shared/swallow.ts";
import type { PageHostApi } from "../bundle_host.ts";
import { click_like_a_hint } from "../hints/actions.ts";
import { is_shown } from "../shown.ts";
import { child_of, parent_of, sibling_of } from "./walk.ts";
import type { TreeRow } from "./walk.ts";

type TreeWindow = { desertfox_host?: PageHostApi; desertfox_tree_ready?: true };
const tree_window = window as unknown as TreeWindow;

type TreeArgs = { action: string; preset?: "none" | "aria"; selector: string; link?: string; depth: string; depth_from: "item" | "inside" | "above"; depth_at?: string; fold_by?: "click" | "keys"; fold: string; folded: string; times?: number };

// A tree widget folds by the arrows. Some read only the key code, so both go.
const arrow = (open: boolean) => ({ key: open ? "ArrowRight" : "ArrowLeft", key_code: open ? 39 : 37 });

// The selectors an ARIA tree stands for. `:scope` finds nothing inside the item, so the landing focuses the treeitem itself and not the first link inside it, which for a branch belongs to a child.
const ARIA_ARGS = { selector: "[role=treeitem]", link: ":scope", depth: "aria-level", fold_by: "keys", folded: "[aria-expanded=false]" } as const;

function treeitems_around(item: Element): number {
  let count = 0;
  for (let at = item.parentElement?.closest("[role=treeitem]"); at; at = at.parentElement?.closest("[role=treeitem]")) count++;
  return count;
}

// An item with no readable depth is not part of the tree (the story above the comments).
function read_rows(args: TreeArgs, current?: Element | null): TreeRow<Element>[] {
  // Rows stay inside the one tree, so a page with two trees never walks from one into the other.
  const scope = args.preset === "aria" ? (current?.closest("[role=tree]") ?? document) : document;
  const holder = (item: Element) => (args.depth_from === "inside" ? item.querySelector(args.depth_at!) : args.depth_from === "above" ? item.closest(args.depth_at!) : item);
  const rows = Array.from(scope.querySelectorAll(args.selector)).filter(is_shown).map((item) => ({ item, depth: Number.parseInt(holder(item)?.getAttribute(args.depth) ?? "", 10) }));
  // A nested tree may leave out aria-level, since its nesting says the level.
  if (args.preset === "aria") for (const row of rows) if (Number.isNaN(row.depth)) row.depth = treeitems_around(row.item) + 1;
  return rows.filter((row) => Number.isFinite(row.depth));
}

// A treeitem nests its children, so only the item itself says whether it is folded.
const is_folded = (item: Element, { folded, preset }: TreeArgs): boolean => !!folded && (preset === "aria" ? item.matches(folded) : !!(item.closest(folded) ?? item.querySelector(folded)));

// The fold control that shows, in the item or the item itself.
function fold_control(item: Element, fold: string): HTMLElement {
  const control = fold ? (item.matches(fold) ? item : item.querySelector(fold)) : null;
  if (!control || !is_shown(control)) throw new RuntimeRefusal("No fold control in this item");
  return control as HTMLElement;
}

// With no host, content.js has not started here, and the load it asks for later registers the handler.
const host = tree_window.desertfox_host;
if (!tree_window.desertfox_tree_ready && host) {
  tree_window.desertfox_tree_ready = true;
  // The landing is `page.item`'s own, so focus, scroll, the box and the last move match j. It starts from the item that holds the focus, so the target takes the focus first, and scrolls into view first because a focus off screen is not the start.
  // A failed outcome (the item bundle did not load) stops the run with its message.
  const ask = async (id: string, args: Record<string, unknown>, bundle: "item" | "site_actions" = "item") => {
    const outcome = await host.run_command_(id, bundle, args);
    if (!outcome.ok) throw new RuntimeRefusal(outcome.message);
  };
  const land = async (item: Element, { selector, link }: TreeArgs) => {
    const { top, bottom } = item.getBoundingClientRect();
    if (top < 0 || bottom > innerHeight) item.scrollIntoView({ block: bottom - top > innerHeight ? "start" : "center", behavior: "instant" });
    if ((item as HTMLElement).tabIndex < 0) item.setAttribute("tabindex", "-1");
    (item as HTMLElement).focus({ preventScroll: true });
    await ask("page.item", { selector, link, direction: "current" });
  };
  const run = async (given: TreeArgs) => {
    const args: TreeArgs = given.preset === "aria" ? { ...given, ...ARIA_ARGS } : given;
    let picked: Element | undefined;
    await ask("item.current", { take: (item?: Element) => (picked = item) });
    // The finder lists a branch of a tree by its label, which sits inside the treeitem.
    const current = args.preset === "aria" ? picked?.closest("[role=treeitem]") : picked;
    if (args.preset === "aria" && current?.closest("[role=tree]")?.hasAttribute("aria-activedescendant")) throw new RuntimeRefusal("This tree uses aria-activedescendant");
    const rows = read_rows(args, current);
    const at = rows.findIndex((row) => row.item === current);
    if (at === -1) throw new RuntimeRefusal("No current item");
    // The click can move the focus onto the control, so the landing puts it back on the item. A key goes to the focus, so the landing comes first.
    const fold_item = async (index: number, open: boolean) => {
      const item = rows[index]!.item;
      if (args.fold_by === "keys") {
        // ArrowLeft on a leaf moves the page focus to the parent, so only an item that can fold gets a key.
        if (!item.hasAttribute("aria-expanded")) throw new RuntimeRefusal("Nothing to fold");
        await land(item, args);
        return ask("page.send_key", arrow(open), "site_actions");
      }
      click_like_a_hint(fold_control(item, args.fold));
      return land(item, args);
    };
    const folded_at = (index: number) => is_folded(rows[index]!.item, args);
    // The closest treeitem around the item is its parent. A role=none or role=group wrapper between them is not one. A flat tree, where treeitems do not nest, has no such ancestor and goes by depth.
    const parent_at = (index: number) => {
      const found = args.preset === "aria" ? rows.findIndex((row) => row.item === rows[index]!.item.parentElement?.closest("[role=treeitem]")) : -1;
      return found === -1 ? parent_of(rows, index) : found;
    };
    const walk = (step: (index: number) => number | undefined, none: string) => {
      let index = step(at);
      if (index === undefined) throw new RuntimeRefusal(none);
      for (let left = (args.times ?? 1) - 1; left > 0 && step(index) !== undefined; left--) index = step(index)!;
      return land(rows[index]!.item, args);
    };
    switch (args.action) {
      case "parent":
        return walk(parent_at, "No parent");
      case "next":
        return walk((index) => sibling_of(rows, index, 1), "No next sibling");
      case "prev":
        return walk((index) => sibling_of(rows, index, -1), "No previous sibling");
      case "child":
        if (folded_at(at)) return fold_item(at, true);
        return walk((index) => child_of(rows, index), "No child");
      case "toggle":
        return fold_item(at, folded_at(at));
      case "unfold":
        return folded_at(at) ? fold_item(at, true) : undefined;
      default: {
        // Fold: a leaf or a folded item has nothing of its own to fold, so its parent folds.
        const target = folded_at(at) || child_of(rows, at) === undefined ? parent_at(at) : at;
        if (target === undefined) throw new RuntimeRefusal("Nothing to fold");
        return fold_item(target, false);
      }
    }
  };
  // Every later key waits for the run to land, so a key typed during the first load (a second l, or j) starts from the item this run leaves.
  host.register_handler_("page.tree", (args) => {
    const done = run(args as unknown as TreeArgs);
    host.hold_keys_until_(refused_as(done.then(() => []), []), true);
    return done;
  });
}
