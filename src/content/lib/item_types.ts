// The types the item bundle shares with the content root and `next_page`: the finder's region, the `page.item` arguments and the cursor `]]` reads.

export type FinderKind = "list" | "grid" | "none";

// `links` holds the link of each item that takes the focus, or undefined for an item with no link. `sections` is the block of groups the items sit in, kept for a later key that jumps between sections (a front page sorts its cards into sections). `row_` marks the list of a site row's items, which the picker offers (`lists_with_row` in `main.ts`) and which is no finder list. `timed_out_` marks a `none` that only says the time budget ran out. The last three fields belong to the ARIA lists (`aria_lists.ts`): `home_` is the widget, which names the region again after the page replaced its rows, `box_selector_` is what the box follows a page script's focus by (their items are often classless), and `focus_none_` says the widget names its own active row, so a pick or a move leaves the focus where it is.
export type Region<N> = { kind: FinderKind; items: N[]; links: Map<N, N | undefined>; sections?: N[]; pick_only_?: true; row_?: true; home_?: N; box_selector_?: string; focus_none_?: true };

export type MoveDirection = "down" | "up" | "left" | "right";
export type SectionDirection = "next_section" | "prev_section";
export type ItemDirection = MoveDirection | SectionDirection | "first" | "last" | "current" | "other_end";
// With no selector (undefined, or the empty text the validator fills in) the items come from the derived row (`ItemPage.derived`).
export type ItemArgs = { selector?: string; link?: string; section?: string; direction: ItemDirection; times?: number; hover?: boolean; extend?: boolean; extent?: string };

// What `]]` reads of the last move, to carry the box onto the first item a load adds. `item_` is gone once the page dropped the item and nothing else holds it.
export type ItemCursor = { item_: Element | undefined; selector_: string; shown_: boolean; land_: (item: Element) => void };
