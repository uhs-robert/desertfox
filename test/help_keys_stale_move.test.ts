import assert from "node:assert/strict";
import { test } from "node:test";
import { create_keys_session } from "../src/help/keys_model.ts";
import type { BindingRow } from "../src/shared/messages.ts";

const row = (keys: string, text: string): BindingRow => ({ mode: "normal", keys, text, origin: "default" });

function session_over(rows: { now: BindingRow[] }) {
  const changes: Record<string, unknown>[] = [];
  const session = create_keys_session({
    send: async (message) => {
      if (message.type === "list_bindings") return { ok: true, bindings: rows.now };
      if (message.type === "change_keymap") changes.push(message);
      return { ok: false, message: "refused" };
    },
    schedule: () => () => undefined,
    on_change: () => undefined,
  });
  return { session, changes };
}

test("a move after a refresh sends the text the row had when it opened, so the background can refuse it", async () => {
  const rows = { now: [row("J", "tab.next")] };
  const { session, changes } = session_over(rows);
  await session.load();
  session.open_row(rows.now[0]!);
  // Another tab rebinds J, and the storage event refreshes this page.
  rows.now = [{ ...row("J", "tab.close"), origin: "edit" }];
  await session.refresh();
  assert.equal(session.state.open?.original?.text, "tab.close");
  session.capture("X");
  await session.save();
  assert.deepEqual([changes.at(-1)?.move_from, changes.at(-1)?.move_from_text], ["J", "tab.next"]);

  // Opening the row again takes its new text, so the move can go through.
  session.open_row(rows.now[0]!);
  await session.save();
  assert.equal(changes.at(-1)?.move_from_text, "tab.close");
});
