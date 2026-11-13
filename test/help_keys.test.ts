import assert from "node:assert/strict";
import { test } from "node:test";
import { actions_of, CHECK_DELAY_MS, create_keys_session, matches_filter, row_id } from "../src/help/keys_model.ts";
import { create_key_capture } from "../src/help/keys_page.ts";
import type { BindingRow } from "../src/shared/messages.ts";

const row = (over: Partial<BindingRow> & { keys: string; text: string }): BindingRow => ({ mode: "normal", origin: "default", ...over });

function make(rows: BindingRow[], answer_of: (message: { type: string; [key: string]: unknown }) => unknown = () => ({ ok: true, saves: true, problems: [], warnings: [], shadows: [] })) {
  const sent: { type: string; [key: string]: unknown }[] = [];
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  const changes: string[] = [];
  let current = rows;
  const session = create_keys_session({
    send: async (message) => {
      sent.push(message as never);
      return message.type === "list_bindings" ? { ok: true, bindings: current } : answer_of(message as never);
    },
    schedule: (run, ms) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return () => void (timer.live = false);
    },
    on_change: (what) => void changes.push(what),
  });
  const fire = async () => {
    const timer = timers.filter((candidate) => candidate.live).at(-1)!;
    timer.live = false;
    timer.run();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { session, sent, timers, changes, fire, set_rows: (next: BindingRow[]) => void (current = next) };
}

const J = row({ keys: "J", text: "tab.next" });
const K = row({ keys: "K", text: "tab.prev" });

test("rows load, filter by keys, text or mode, and a failed load shows the reason", async () => {
  const { session } = make([J, K]);
  await session.load();
  assert.equal(session.state.rows.length, 2);
  assert.equal(matches_filter(J, "next"), true);
  assert.equal(matches_filter(J, "prev"), false);
  assert.equal(matches_filter(J, " NORMAL "), true);
  const failing = create_keys_session({ send: async () => ({ ok: false, message: "background down" }), on_change: () => undefined });
  await failing.load();
  assert.match(failing.state.error ?? "", /background down/);
});

test("capture builds a sequence, Backspace drops a token, Clear empties it, cancel restores the row", async () => {
  const { session } = make([J]);
  await session.load();
  session.open_row(J);
  assert.deepEqual(session.state.open?.tokens, ["J"]);
  session.capture("<C-d>");
  session.capture("x");
  assert.deepEqual(session.state.open?.tokens, ["J", "<C-d>", "x"]);
  session.capture_backspace();
  assert.deepEqual(session.state.open?.tokens, ["J", "<C-d>"]);
  session.cancel_capture();
  assert.deepEqual(session.state.open?.tokens, ["J"]);
  session.clear_keys();
  assert.deepEqual(session.state.open?.tokens, []);
  session.open_new("insert");
  session.capture("a");
  session.cancel_capture();
  assert.deepEqual(session.state.open?.tokens, []);
});

test("the check waits 250 ms after the last change, sends once, and the page keeps the background's spelling", async () => {
  const { session, sent, timers, fire } = make([J], () => ({ ok: true, saves: true, problems: [], warnings: ["w"], shadows: [{ keys: "J", text: "tab.next" }], keys: "<C-d>" }));
  await session.load();
  session.open_new("normal");
  session.capture("<C-D>");
  session.set_text("tab.c");
  session.set_text("tab.close");
  assert.equal(sent.filter((message) => message.type === "check_binding").length, 0);
  assert.equal(timers.filter((timer) => timer.live).length, 1);
  assert.equal(timers.at(-1)!.ms, CHECK_DELAY_MS);
  await fire();
  const checks = sent.filter((message) => message.type === "check_binding");
  assert.deepEqual(checks, [{ type: "check_binding", mode: "normal", keys: "<C-D>", text: "tab.close" }]);
  assert.deepEqual(session.state.open?.tokens, ["<C-d>"]);
  assert.equal(session.state.open?.check.state, "done");
});

test("a late check answer for an old text is dropped", async () => {
  let release: (answer: unknown) => void = () => undefined;
  const { session, fire } = make([], () => new Promise((resolve) => (release = resolve)));
  await session.load();
  session.open_new("normal");
  session.capture("x");
  session.set_text("tab.close");
  const waiting = fire();
  session.set_text("tab.next");
  release({ ok: true, saves: false, problems: ["old"], warnings: [], shadows: [] });
  await waiting;
  assert.notEqual(session.state.open?.check.state, "done");
});

test("save sends the set, and an answer row moves the editor onto it", async () => {
  const saved = row({ keys: "J", text: "tab.close", origin: "edit", default_text: "tab.next" });
  const { session, sent } = make([J], (message) => (message.type === "change_keymap" ? { ok: true, row: saved, message: "Bound J in normal mode" } : { ok: true, saves: true, problems: [], warnings: [], shadows: [] }));
  await session.load();
  session.open_row(J);
  assert.equal(actions_of(session.state.open!).save, false);
  session.set_text("tab.close");
  assert.equal(actions_of(session.state.open!).save, true);
  await session.save();
  assert.deepEqual(sent.at(-1), { type: "change_keymap", mode: "normal", keys: "J", action: "set", text: "tab.close" });
  assert.equal(session.state.open?.original?.origin, "edit");
  assert.equal(session.state.open?.message?.ok, true);
  assert.equal(actions_of(session.state.open!).reset, true);
});

test("a refused save keeps the draft and shows the reason", async () => {
  const { session } = make([J], (message) => (message.type === "change_keymap" ? { ok: false, message: "not saved: bad", problems: ["bad", "worse"] } : { ok: true, saves: true, problems: [], warnings: [], shadows: [] }));
  await session.load();
  session.open_row(J);
  session.set_text("nope");
  await session.save();
  assert.equal(session.state.open?.text, "nope");
  assert.match(session.state.open?.message?.text ?? "", /bad[\s\S]*worse/);
  assert.equal(session.state.open?.message?.ok, false);
});

test("Remove and Reset send their action, and which buttons show follows the row's origin", async () => {
  const removed = row({ keys: "J", text: "", origin: "removed", default_text: "tab.next" });
  const { session, sent } = make([J], (message) => ({ ok: true, row: message.action === "remove" ? removed : J, message: "done" }));
  await session.load();
  session.open_row(J);
  assert.deepEqual(actions_of(session.state.open!), { save: false, remove: true, reset: false });
  await session.remove();
  assert.deepEqual(sent.at(-1), { type: "change_keymap", mode: "normal", keys: "J", action: "remove" });
  assert.deepEqual(actions_of(session.state.open!), { save: false, remove: false, reset: true });
  await session.reset();
  assert.deepEqual(sent.at(-1), { type: "change_keymap", mode: "normal", keys: "J", action: "reset" });
});

test("a multi-step row is read-only: no save and no check, but it can be unbound", async () => {
  const multi = row({ keys: "gx", text: "tab.next ; tab.prev" });
  const { session, sent, timers } = make([multi]);
  await session.load();
  session.open_row(multi);
  session.set_text("tab.close");
  assert.equal(actions_of(session.state.open!).save, false);
  assert.equal(actions_of(session.state.open!).remove, true);
  assert.equal(timers.filter((timer) => timer.live).length, 0);
  assert.equal(sent.some((message) => message.type === "check_binding"), false);
});

test("a refresh keeps each row's draft and reads the row under it again", async () => {
  const { session, set_rows } = make([J, K]);
  await session.load();
  session.open_row(J);
  session.set_text("tab.close");
  session.open_row(K);
  session.set_text("tab.goto");
  set_rows([row({ keys: "J", text: "tab.prev", origin: "file", default_text: "tab.next" }), K]);
  await session.refresh();
  assert.equal(session.state.open?.text, "tab.goto");
  session.open_row(row({ keys: "J", text: "tab.prev", origin: "file" }));
  assert.equal(session.state.open?.id, row_id("normal", "J"));
  assert.equal(session.state.open?.text, "tab.close");
  assert.equal(session.state.open?.original?.text, "tab.prev");
  // A row that matches its binding is not kept: it reads fresh next time.
  session.open_row(K);
  session.set_text("tab.prev");
  session.open_row(J);
  session.open_row(K);
  assert.equal(session.state.open?.text, "tab.prev");
});

test("overlapping refreshes share one more pass, and dispose cancels a pending check", async () => {
  const { session, sent, timers } = make([J]);
  await session.load();
  await Promise.all([session.refresh(), session.refresh(), session.refresh()]);
  assert.equal(sent.filter((message) => message.type === "list_bindings").length, 3);
  session.open_new("normal");
  session.capture("x");
  session.set_text("tab.close");
  session.dispose();
  assert.equal(timers.filter((timer) => timer.live).length, 0);
});

// A box with the focus API the capture uses. Counts its listeners, so a leak shows.
function fake_box() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    isConnected: true,
    addEventListener: (type: string, listener: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener),
    removeEventListener: (type: string, listener: () => void) => void listeners.get(type)?.delete(listener),
    fire: (type: string) => listeners.get(type)?.forEach((listener) => listener()),
    count: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}
type Press = { key: string; code?: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean };
function press(init: Press) {
  const event = { code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  return event;
}

test("the capture takes keys only while its box has focus, and leaves no listener after release", () => {
  const box = fake_box();
  const holder = globalThis as unknown as { document: { activeElement: unknown } };
  holder.document = { activeElement: null };
  const capture = create_key_capture();
  const got: string[] = [];
  const release = capture.bind(box as never, { token: (token) => got.push(token), backspace: () => got.push("<BS>"), cancel: () => got.push("<cancel>") });

  const outside = press({ key: "j" });
  capture.on_keydown(outside as never);
  assert.deepEqual([outside.prevented, outside.stopped, got.length], [false, false, 0]);

  holder.document.activeElement = box;
  box.fire("focus");
  for (const event of [press({ key: "j" }), press({ key: "d", ctrlKey: true }), press({ key: "Shift", shiftKey: true }), press({ key: "Backspace" }), press({ key: "Escape" }), press({ key: "Escape", shiftKey: true })]) {
    capture.on_keydown(event as never);
    assert.deepEqual([event.prevented, event.stopped], [true, true], event.key);
  }
  assert.deepEqual(got, ["j", "<C-d>", "<BS>", "<cancel>", "<S-Escape>"]);

  box.fire("blur");
  const after_blur = press({ key: "j" });
  capture.on_keydown(after_blur as never);
  assert.equal(after_blur.stopped, false);

  box.fire("focus");
  box.isConnected = false;
  const detached = press({ key: "j" });
  capture.on_keydown(detached as never);
  assert.equal(detached.stopped, false);
  assert.equal(capture.is_active(), false);

  assert.ok(box.count() > 0);
  release();
  assert.equal(box.count(), 0);
});

test("a second bind takes over, and the first box's blur does not drop it", () => {
  const first = fake_box();
  const second = fake_box();
  const holder = globalThis as unknown as { document: { activeElement: unknown } };
  holder.document = { activeElement: first };
  const capture = create_key_capture();
  const got: string[] = [];
  capture.bind(first as never, { token: () => got.push("first"), backspace: () => undefined, cancel: () => undefined });
  capture.bind(second as never, { token: () => got.push("second"), backspace: () => undefined, cancel: () => undefined });
  first.fire("focus");
  holder.document.activeElement = second;
  second.fire("focus");
  first.fire("blur");
  capture.on_keydown(press({ key: "x" }) as never);
  assert.deepEqual(got, ["second"]);
});

