// The handlers one bundle calls in another, or the background relays to, with the bundle that registers each and the args it takes.
// `register_handler_` and `run_command_` check an id in this map against it, so a caller and its handler cannot drift apart. An id outside the map keeps loose args: the registry commands that no bundle calls by hand get theirs from the param schema.
// Types only. Nothing here reaches a bundle, and the args stay unchecked at run time.

import type { Mode } from "../shared/command.ts";
import type { HeadingItem } from "../shared/messages/content.ts";
import type { ToastKind } from "../shared/messages/tab.ts";
import type { BundleName } from "../shared/bundles.ts";
import type { ModeAction } from "./hints/actions.ts";
import type { Region } from "./item/finder.ts";
import type { ItemArgs, ItemCursor } from "./item/pick.ts";
import type { PendingPrefix } from "./key_flow.ts";
import type { ClipboardArgs } from "./site_actions/clipboard.ts";
import type { SendKeyArgs } from "./site_actions/send_key.ts";
import type { BadgeState } from "./ui/mode_label.ts";

export type ListRegion = Region<Element>;

// The `take` callbacks hand a result back to the caller, because a handler answers only an Outcome.
type ItemListsArgs = { selector?: string | undefined; row_only?: boolean | undefined } & (
  | { region: ListRegion; focus?: HTMLElement | undefined; take?: undefined }
  | { take: (regions: ListRegion[]) => void; region?: undefined; focus?: undefined }
);
type ItemRange = [items?: Element[], keys?: string[], from?: number, to?: number, anchor?: number];

// A frame's relayed call carries the frame it came from. `remote_id` names the command line a subframe opened.
type FromFrame = { from_frame?: number };
type OfLine = { remote_id?: string };

type BundleCalls = {
  "hint.run": { bundle: "hints"; args: Record<string, unknown> };
  "hint.unhover": { bundle: "hints"; args: Record<string, never> };
  "heading.list": { bundle: "hints"; args: { report: (items: HeadingItem[]) => void } };
  "heading.clear": { bundle: "hints"; args: Record<string, never> };

  // `Mode`, not `CaretMode`: `is_caret_mode` is a boolean, so a caller cannot narrow to the caret modes. The handler narrows.
  "caret.mode": { bundle: "caret"; args: { mode: Mode } };
  "find.live": { bundle: "caret"; args: { text: string; report: (status: string) => void } };
  "find.end": { bundle: "caret"; args: { keep: boolean } };
  "find.clear": { bundle: "caret"; args: Record<string, never> };

  "grab.mode": { bundle: "grab"; args: { mode: ModeAction } };

  // What content.js sends on each prefix change: the setting values ride along because the timer in the bundle has no keymap.
  whichkey: { bundle: "whichkey"; args: { prefix?: PendingPrefix | undefined; at_once?: boolean | undefined; delay_ms?: number | undefined; skip?: readonly string[] | undefined } };
  "whichkey.draw": { bundle: "whichkey"; args: Record<string, unknown> };
  "whichkey.erase": { bundle: "whichkey"; args: Record<string, unknown> };
  "whichkey.media_panel": { bundle: "whichkey"; args: Record<string, never> };

  "cmdline.open": { bundle: "cmdline"; args: Record<string, unknown> };
  "cmdline.token": { bundle: "cmdline"; args: FromFrame & { token: string } };
  "cmdline.headings": { bundle: "cmdline"; args: FromFrame & { items: HeadingItem[] } };
  "cmdline.find_status": { bundle: "cmdline"; args: FromFrame & { text: string } };
  "cmdline.focus": { bundle: "cmdline"; args: OfLine };
  "cmdline.end": { bundle: "cmdline"; args: OfLine & { tokens?: string[] } };
  "cmdline.find_text": { bundle: "cmdline"; args: OfLine & { text: string } };
  "cmdline.find_end": { bundle: "cmdline"; args: OfLine & { keep?: boolean } };
  "cmdline.headings_ask": { bundle: "cmdline"; args: OfLine & { clear?: boolean } };

  "ui.toast": { bundle: "ui"; args: { message: string; duration_ms: number; kind?: ToastKind | undefined } };
  "ui.frame_watch": { bundle: "ui"; args: { on: boolean } };
  "ui.badge_count": { bundle: "ui"; args: { count?: number | undefined; from_frame: number } };
  "ui.badge": { bundle: "ui"; args: Partial<BadgeState> };

  "text.input": { bundle: "text"; args: { field_: Element; before_: string; type_?: string | undefined; autocomplete_?: string | undefined } };
  "text.flush": { bundle: "text"; args: { after_?: string | undefined } };

  "item.start": { bundle: "item"; args: { selectors?: string[] | undefined } };
  "item.mark": { bundle: "item"; args: { element: Element } };
  "item.lists": { bundle: "item"; args: ItemListsArgs };
  "item.current": { bundle: "item"; args: { take: (item: Element | undefined, link: Element | undefined) => void } };
  "item.range": { bundle: "item"; args: { take: (...range: ItemRange) => void } };
  "item.cursor": { bundle: "item"; args: { take: (cursor: ItemCursor | undefined) => void } };
  // Callers pass fields that may be undefined (tree reads them from its own args), which `exactOptionalPropertyTypes` refuses on ItemArgs itself.
  "page.item": { bundle: "item"; args: { [Key in keyof ItemArgs]: ItemArgs[Key] | undefined } };

  "page.send_key": { bundle: "site_actions"; args: SendKeyArgs };
  "page.clipboard": { bundle: "site_actions"; args: ClipboardArgs };
};

// The args of a handler id. An id outside the map takes any record.
export type ArgsOf<Id extends string> = Id extends keyof BundleCalls ? BundleCalls[Id]["args"] : Record<string, unknown>;
// The bundle that registers the id. The name a caller passes must be it.
export type BundleOf<Id extends string> = Id extends keyof BundleCalls ? BundleCalls[Id]["bundle"] : BundleName;
