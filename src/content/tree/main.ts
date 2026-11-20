// The `tree` bundle: `page.tree`, which moves and folds through nested items (the comments of a thread) by their depth. Loaded on the first press.

import { RuntimeRefusal } from "../../shared/command.ts";
import { keep_chain } from "../../shared/swallow.ts";
import type { PageHostApi } from "../bundle_host.ts";
import { click_like_a_hint } from "../hints/actions.ts";
import { is_shown } from "../shown.ts";
import { child_of, parent_of, sibling_of } from "./walk.ts";
import type { TreeRow } from "./walk.ts";

type TreeWindow = { desertfox_host?: PageHostApi; desertfox_tree_ready?: true };
const tree_window = window as unknown as TreeWindow;

type TreeArgs = { action: string; selector: string; link?: string; depth: string; depth_from: "item" | "inside" | "above"; depth_at?: string; fold: string; folded: string; times?: number };

// An item with no readable depth is not part of the tree (the story above the comments).
function read_rows(args: TreeArgs): TreeRow<Element>[] {
  const holder = (item: Element) => (args.depth_from === "inside" ? item.querySelector(args.depth_at!) : args.depth_from === "above" ? item.closest(args.depth_at!) : item);
  const rows = Array.from(document.querySelectorAll(args.selector)).filter(is_shown).map((item) => ({ item, depth: Number.parseInt(holder(item)?.getAttribute(args.depth) ?? "", 10) }));
  return rows.filter((row) => Number.isFinite(row.depth));
}

const is_folded = (item: Element, folded: string): boolean => !!folded && !!(item.closest(folded) ?? item.querySelector(folded));

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
  const land = async (item: Element, { selector, link }: TreeArgs) => {
    const { top, bottom } = item.getBoundingClientRect();
    if (top < 0 || bottom > innerHeight) item.scrollIntoView({ block: bottom - top > innerHeight ? "start" : "center", behavior: "instant" });
    if ((item as HTMLElement).tabIndex < 0) item.setAttribute("tabindex", "-1");
    (item as HTMLElement).focus({ preventScroll: true });
    await host.run_command_("page.item", "item", { selector, link, direction: "current" });
  };
  // Two keys pressed together (the second replays after the bundle loads) must not both start from the item the first one left, so the runs go one at a time.
  let turn: Promise<unknown> = Promise.resolve();
  const run = async (args: TreeArgs) => {
    let current: Element | undefined;
    await host.run_command_("item.current", "item", { take: (item?: Element) => (current = item) });
    const rows = read_rows(args);
    const at = rows.findIndex((row) => row.item === current);
    if (at === -1) throw new RuntimeRefusal("No current comment");
    // The click can move the focus onto the control, so the landing puts it back on the item.
    const click_fold = (index: number) => {
      click_like_a_hint(fold_control(rows[index]!.item, args.fold));
      return land(rows[index]!.item, args);
    };
    const folded_at = (index: number) => is_folded(rows[index]!.item, args.folded);
    const walk = (step: (index: number) => number | undefined, none: string) => {
      let index = step(at);
      if (index === undefined) throw new RuntimeRefusal(none);
      for (let left = (args.times ?? 1) - 1; left > 0 && step(index) !== undefined; left--) index = step(index)!;
      return land(rows[index]!.item, args);
    };
    switch (args.action) {
      case "parent":
        return walk((index) => parent_of(rows, index), "No parent");
      case "next":
        return walk((index) => sibling_of(rows, index, 1), "No next sibling");
      case "prev":
        return walk((index) => sibling_of(rows, index, -1), "No previous sibling");
      case "child":
        if (folded_at(at)) return click_fold(at);
        return walk((index) => child_of(rows, index), "No child");
      case "toggle":
        return click_fold(at);
      case "unfold":
        return folded_at(at) ? click_fold(at) : undefined;
      default: {
        // Fold: a leaf or a folded item has nothing of its own to fold, so its parent folds.
        const target = folded_at(at) || child_of(rows, at) === undefined ? parent_of(rows, at) : at;
        if (target === undefined) throw new RuntimeRefusal("Nothing to fold");
        return click_fold(target);
      }
    }
  };
  host.register_handler_("page.tree", (args) => {
    const done = turn.then(() => run(args as unknown as TreeArgs));
    turn = keep_chain(done);
    return done;
  });
}
