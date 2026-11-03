// The `caret` bundle: caret mode and visual mode. Loaded on the first `V`, it registers a sink for each mode and
// the handlers of `caret.move` and `visual.act`.

import { FALLBACK_ENGINE_NAME } from "../../shared/config.ts";
import type { BundleHostApi, ExitDestination } from "../bundle_host.ts";
import { move_once, SCREEN_LINE_UNITS } from "./motion.ts";
import type { Motion } from "./motion.ts";
import { screen_line_target } from "./screen_line.ts";
import { apply_selection_colors, clear_selection_colors } from "./selection_colors.ts";
import { selected_text, selected_span, swap_ends, with_caret } from "./selection_state.ts";
import type { Cursor } from "./selection_state.ts";
import { build_text_model } from "./text_model.ts";
import type { TextModel } from "./text_model.ts";
import { first_visible_index } from "./start_point.ts";

type CaretWindow = { oasisfox_host: BundleHostApi; oasisfox_caret_ready?: true };
const page = window as unknown as CaretWindow;

type Session = { model: TextModel; cursor: Cursor; mode: "caret" | "visual" };
let session: Session | undefined;

function paint(open: Session): void {
  const { from, to } = selected_span(open.cursor);
  const selection = getSelection()!;
  const start = open.model.point_at(from);
  const end = open.model.point_at(to - 1);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  // An empty line has no character to select, so the caret there is not drawn.
  range.setEnd(end.node, open.model.text[to - 1] === "\n" ? end.offset : end.offset + 1);
  selection.removeAllRanges();
  selection.addRange(range);
  const focus = open.model.point_at(open.cursor.caret).node.parentElement;
  focus?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// Where a new session starts: the caret's place in the page's own selection if it is on screen, else the first visible text.
function start_session(mode: "caret" | "visual", element?: Element): Session | undefined {
  const model = build_text_model(element ?? document.body);
  if (model.text === "") return undefined;
  const caret = first_visible_index(model, getSelection()!, element === undefined);
  return { model, cursor: { anchor: caret, caret }, mode };
}

function end_session(): void {
  session = undefined;
  getSelection()?.removeAllRanges();
  clear_selection_colors();
}

function ensure_session(mode: "caret" | "visual"): Session | undefined {
  session ??= start_session(mode);
  if (!session) {
    page.oasisfox_host.set_mode("normal");
    return undefined;
  }
  // Caret mode shows one character, so leaving visual mode drops the anchor.
  if (mode === "caret") session.cursor = { anchor: session.cursor.caret, caret: session.cursor.caret };
  session.mode = mode;
  paint(session);
  void apply_selection_colors(mode);
  return session;
}

const sink_for = (mode: "caret" | "visual") => ({
  // Showing the caret on entry is what makes `V` draw it at once.
  enter: () => void ensure_session(mode),
  on_token: (token: string): "handled" | "pass" => {
    if (mode === "caret" || (token !== "<Escape>" && token !== "<C-[>")) return "pass";
    // Escape in visual mode goes back to caret mode, and the keymap never sees it.
    page.oasisfox_host.set_mode("caret");
    return "handled";
  },
  // Between caret and visual the highlight stays. Every other way out clears it.
  exit: (destination: ExitDestination) => {
    if (destination !== "caret" && destination !== "visual") end_session();
  },
});

const handle_move = (args: Record<string, unknown>): void => {
  const open = ensure_session(session?.mode ?? "caret");
  if (!open) return;
  const motion: Motion = { unit: args.unit as Motion["unit"], direction: (args.direction as Motion["direction"] | undefined) ?? "forward", big: args.big === true };
  const caret = SCREEN_LINE_UNITS.includes(motion.unit) ? screen_line_target(open.model, getSelection()!, open.cursor.caret, motion) : move_once(open.model.text, open.cursor.caret, motion);
  open.cursor = with_caret(open.cursor, caret, open.mode === "visual");
  paint(open);
};

const handle_act = (args: Record<string, unknown>): void => {
  const open = ensure_session("visual");
  if (!open) return;
  const action = args.action as "yank" | "swap" | "search";
  if (action === "swap") {
    open.cursor = swap_ends(open.cursor);
    paint(open);
    return;
  }
  const text = selected_text(open.model.text, open.cursor);
  if (action === "yank") {
    void navigator.clipboard.writeText(text);
    page.oasisfox_host.show_toast(`Copied ${text.length > 40 ? text.slice(0, 40) + "..." : text}`);
  } else void browser.runtime.sendMessage({ type: "run", invocations: [{ id: "open.search", args: { engine: FALLBACK_ENGINE_NAME, query: text } }], mode: "visual" });
  page.oasisfox_host.set_mode("caret");
};

// A bundle may run twice, and a second run would hold fresh state next to the first.
if (!page.oasisfox_caret_ready) {
  page.oasisfox_caret_ready = true;
  page.oasisfox_host.register_sink("caret", sink_for("caret"));
  page.oasisfox_host.register_sink("visual", sink_for("visual"));
  page.oasisfox_host.register_handler("caret.move", handle_move);
  page.oasisfox_host.register_handler("visual.act", handle_act);
}
