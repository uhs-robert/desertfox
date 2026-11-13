import assert from "node:assert/strict";
import { test } from "node:test";
import { create_sessions } from "../../../src/content/caret/caret_session.ts";
import type { Session } from "../../../src/content/caret/caret_session.ts";
import { yank_text } from "../../../src/content/caret/copy_text.ts";
import type { Mode } from "../../../src/shared/command.ts";
import type {
  CaretMode,
  Cursor,
} from "../../../src/content/caret/selection_state.ts";
import type { TextModel } from "../../../src/content/caret/text_model.ts";

const model_of = (text: string) => ({ text }) as TextModel;

// A host whose mode changes run the sinks at once, as the bundle host does once caret.js is in.
function setup({ text = "alpha beta" } = {}) {
  let mode: Mode = "normal";
  let held = model_of(text);
  let stale = false;
  let foreign: Cursor | number | undefined;
  const log: string[] = [];
  const colors: CaretMode[] = [];
  let ended = 0;
  const sessions_host = {
    get_mode: () => mode,
    set_mode_: (next: Mode) => {
      const left = mode;
      mode = next;
      log.push(`mode ${next}`);
      if (["caret", "visual", "visual_line"].includes(left))
        sessions.exit_(next);
      if (next === "caret" || next === "visual" || next === "visual_line") {
        const failed = sessions.enter_(next);
        if (failed) log.push(`toast ${failed}`);
      }
    },
  };
  const sessions = create_sessions({
    host: sessions_host,
    page_text: {
      current: () =>
        stale ? ((stale = false), (held = model_of(held.text))) : held,
      is_current: (model) => model === held && !stale,
      carry: (_from, index, to) => (index < to.text.length ? index : undefined),
    },
    start_: () =>
      held.text === ""
        ? "No text here"
        : { model_: held, cursor: { anchor: 0, caret: 0 } },
    foreign_move_: () => foreign,
    first_visible_: () => 0,
    paint_: (open: Session) => {
      // The paint draws over any outside move.
      foreign = undefined;
      open.span_ = {
        from: Math.min(open.cursor.anchor, open.cursor.caret),
        to: Math.max(open.cursor.anchor, open.cursor.caret) + 1,
      };
      log.push(`paint ${open.mode} ${open.cursor.anchor}-${open.cursor.caret}`);
    },
    set_mode_colors_: (next) => void colors.push(next),
    ended_: () => void ended++,
  });
  return {
    sessions,
    log,
    colors,
    mode: () => mode,
    set_mode: (next: Mode) => sessions_host.set_mode_(next),
    ended: () => ended,
    click: (index: number) => void (foreign = index),
    drag: (cursor: Cursor) => void (foreign = cursor),
    change_page: (next_text?: string) => {
      stale = true;
      if (next_text !== undefined) held = model_of(next_text);
    },
  };
}

test("a handler never starts a session: outside a session mode it enters the mode, and the sink starts it", () => {
  const { sessions, log, mode } = setup();
  assert.equal(sessions.current_(), undefined, "normal mode has a session");
  const open = sessions.require_("caret");
  assert.equal(mode(), "caret");
  assert.equal(typeof open, "object");
  assert.equal(sessions.open_(), open);
  assert.deepEqual(log.slice(0, 2), ["mode caret", "paint caret 0-0"]);
});

test("visual.object's mode is entered from caret and line visual mode, and caret.move keeps any session mode", () => {
  const { sessions, set_mode, mode } = setup();
  set_mode("visual_line");
  assert.equal((sessions.require_("caret") as Session).mode, "visual_line");
  assert.equal(mode(), "visual_line");
  assert.equal((sessions.require_("visual") as Session).mode, "visual");
  assert.equal(mode(), "visual");
  set_mode("caret");
  assert.equal((sessions.require_("visual") as Session).mode, "visual");
});

test("a page with no text starts no session, and the mode goes back to normal", () => {
  const { sessions, mode, log } = setup({ text: "" });
  assert.equal(sessions.require_("caret"), undefined);
  assert.equal(mode(), "normal");
  assert.ok(log.includes("toast No text here"));
});

test("a click in visual mode ends it, and caret mode takes the click before the keymap reads the key", () => {
  const { sessions, set_mode, mode, click } = setup();
  set_mode("visual");
  assert.equal(
    sessions.take_click_(),
    false,
    "no click, yet visual mode ended",
  );
  click(6);
  assert.equal(sessions.take_click_(), true);
  assert.equal(mode(), "caret");
  assert.deepEqual(sessions.open_()!.cursor, { anchor: 6, caret: 6 });
});

test("a click in caret mode moves the caret and keeps the mode, and a drag in visual mode is taken whole", () => {
  const { sessions, set_mode, mode, click, drag } = setup();
  set_mode("caret");
  click(3);
  assert.equal(sessions.take_click_(), false);
  assert.deepEqual((sessions.current_() as Session).cursor, {
    anchor: 3,
    caret: 3,
  });
  set_mode("visual");
  drag({ anchor: 2, caret: 5 });
  assert.equal(sessions.take_click_(), false);
  assert.deepEqual((sessions.current_() as Session).cursor, {
    anchor: 2,
    caret: 5,
  });
  assert.equal(mode(), "visual");
});

test("a step that handlers reach in visual mode after a click runs in caret mode", () => {
  const { sessions, set_mode, mode, click } = setup();
  set_mode("visual");
  click(4);
  const open = sessions.current_() as Session;
  assert.equal(open.mode, "caret");
  assert.equal(mode(), "caret");
});

// R9: the copy settles after v, Escape, v. The new run stays in visual mode.
test("a copy that settles after a new visual run leaves the new run in visual mode", async () => {
  const { sessions, set_mode, mode } = setup();
  set_mode("visual");
  const run = sessions.open_()!.generation_;
  let settle = () => {};
  Object.defineProperty(globalThis, "browser", {
    value: { runtime: { sendMessage: async () => ({ ok: true }) } },
    configurable: true,
  });
  const copy = yank_text(
    { writeText: () => new Promise<void>((done) => (settle = done)) },
    "alpha",
    undefined,
    {
      is_same_session_: () => sessions.is_run_(run),
      toast: () => {},
      leave_visual_: () => set_mode("caret"),
    },
  );
  set_mode("caret");
  set_mode("visual");
  settle();
  await copy;
  assert.equal(mode(), "visual");
});

test("a copy still ends its own visual run after the page changed its text", async () => {
  const { sessions, set_mode, mode, change_page } = setup();
  set_mode("visual");
  const run = sessions.open_()!.generation_;
  change_page();
  sessions.current_();
  assert.equal(sessions.is_run_(run), true);
  set_mode("caret");
  assert.equal(mode(), "caret");
});

// The n/N/*/# pin: a step follows only the run it started from.
test("a step whose session ended or was replaced during its await is not the open run", () => {
  const { sessions, set_mode } = setup();
  set_mode("caret");
  const first = sessions.open_()!.generation_;
  set_mode("normal");
  assert.equal(
    sessions.is_run_(first),
    false,
    "the step followed a session that ended",
  );
  set_mode("caret");
  assert.equal(
    sessions.is_run_(first),
    false,
    "the step followed a session that replaced its own",
  );
  assert.equal(
    sessions.is_run_(undefined),
    false,
    "a step from normal mode followed a later session",
  );
});

test("a tab switch or a navigation ends the session, and a step in flight then follows nothing", () => {
  const { sessions, set_mode, ended } = setup();
  set_mode("visual");
  const run = sessions.open_()!.generation_;
  sessions.exit_("page_hidden");
  assert.equal(sessions.open_(), undefined);
  assert.equal(ended(), 1);
  assert.equal(sessions.is_run_(run), false);
});

// R10: the search line holds the session. Enter or Escape paints it before the mode comes back, so entering the mode adopts no stale page selection.
test("the search line keeps the session, and its end paints before the mode comes back", () => {
  const { sessions, set_mode, mode, log } = setup();
  set_mode("visual");
  sessions.current_();
  sessions.hold_for_search_();
  set_mode("cmdline");
  assert.notEqual(
    sessions.open_(),
    undefined,
    "the search line ended the session",
  );
  log.length = 0;
  sessions.release_search_((open) => {
    open.cursor = { anchor: open.cursor.anchor, caret: 7 };
    log.push("follow");
  });
  assert.equal(mode(), "visual");
  assert.equal(log[0], "follow");
  assert.equal(log[1], "mode visual");
  assert.deepEqual(
    sessions.open_()!.cursor,
    { anchor: 0, caret: 7 },
    "the anchor or the match was lost",
  );
});

test("a command line that no search opened ends the session", () => {
  const { sessions, set_mode } = setup();
  set_mode("caret");
  set_mode("cmdline");
  assert.equal(sessions.open_(), undefined);
});

test("a search line from normal mode holds nothing and brings back no mode", () => {
  const { sessions, set_mode, mode } = setup();
  sessions.hold_for_search_();
  set_mode("cmdline");
  sessions.release_search_(() =>
    assert.fail("followed a session that was never held"),
  );
  assert.equal(mode(), "cmdline");
});

// A theme read is async. Each switch between caret and visual asks again, and an exit clears the colors, which drops a read still in flight (selection_colors.test.ts).
test("only a mode change asks for the colors, and an exit ends the session's colors", () => {
  const { sessions, set_mode, colors, ended } = setup();
  set_mode("caret");
  sessions.current_();
  set_mode("visual");
  set_mode("caret");
  assert.deepEqual(colors, ["caret", "visual", "caret"]);
  set_mode("normal");
  assert.equal(ended(), 1);
  set_mode("caret");
  assert.deepEqual(colors, ["caret", "visual", "caret", "caret"]);
});

test("a page that lost all its text ends the session on the next step", () => {
  const { sessions, set_mode, mode, change_page } = setup();
  set_mode("caret");
  change_page("");
  assert.equal(sessions.current_(), "No text here");
  assert.equal(mode(), "normal");
  assert.equal(sessions.open_(), undefined);
});

test("a rebuilt page keeps the caret on its character", () => {
  const { sessions, set_mode, change_page } = setup();
  set_mode("caret");
  const open = sessions.open_()!;
  open.cursor = { anchor: 4, caret: 4 };
  const model_before = open.model_;
  change_page();
  const after = sessions.current_() as Session;
  assert.equal(after, open, "the session object changed");
  assert.notEqual(after.model_, model_before);
  assert.deepEqual(after.cursor, { anchor: 4, caret: 4 });
});
