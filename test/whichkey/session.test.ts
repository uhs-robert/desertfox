import assert from "node:assert/strict";
import { test } from "node:test";
import { create_which_key_session } from "../../src/content/whichkey/session.ts";
import type { WhichKeyPanel } from "../../src/shared/messages.ts";

const panel: WhichKeyPanel = { title: ["keys"], rows: [{ keys: "j", command: "Down", description: "", more: false }], border: "square" };

// A fetch the test answers by hand, like the background answering late.
function make_session() {
  const drawn: string[] = [];
  const waiting: ((answer: WhichKeyPanel) => void)[] = [];
  const session = create_which_key_session(
    () => new Promise<WhichKeyPanel>((resolve) => waiting.push(resolve)),
    (shown) => void drawn.push(shown.title.join("")),
    () => void drawn.push("hidden"),
  );
  return { session, drawn, answer: (index: number) => waiting[index]!(panel) };
}

test("a manual show that a later key hid is not drawn when its answer arrives", async () => {
  const { session, drawn, answer } = make_session();
  const shown = session.show_manual_("normal");
  session.hide();
  answer(0);
  await shown;
  assert.deepEqual(drawn, ["hidden"]);
});

test("a manual show with no key in between is drawn", async () => {
  const { session, drawn, answer } = make_session();
  const shown = session.show_manual_("normal");
  answer(0);
  await shown;
  assert.deepEqual(drawn, ["keys"]);
});

test("a prefix show stays tied to the timer's own is_current_ check", async () => {
  const { session, drawn, answer } = make_session();
  let current = true;
  const shown = session.show_prefix_({ mode: "normal", typed: ["g"] }, () => current);
  current = false;
  answer(0);
  await shown;
  assert.deepEqual(drawn, []);
});

test("an external answer that a later key made stale takes the panel back down, once no other ask is out", async () => {
  const released: string[] = [];
  const waiting: ((answer: WhichKeyPanel) => void)[] = [];
  const session = create_which_key_session(
    () => new Promise<WhichKeyPanel>((resolve) => waiting.push(resolve)),
    () => undefined,
    () => undefined,
    () => void released.push("released"),
  );
  let current = true;
  const first = session.show_prefix_({ mode: "normal", typed: ["g"] }, () => current);
  const second = session.show_prefix_({ mode: "normal", typed: ["g", "t"] }, () => true);
  current = false;
  waiting[0]!({ ...panel, external: true });
  await first;
  assert.deepEqual(released, [], "the second ask is still out and settles the panel");
  waiting[1]!({ ...panel, external: true });
  await second;
  assert.deepEqual(released, [], "a current external answer is the panel, not a leftover");
  const third = session.show_prefix_({ mode: "normal", typed: ["g"] }, () => false);
  waiting[2]!({ ...panel, external: true });
  await third;
  assert.deepEqual(released, ["released"]);
  const plain = session.show_prefix_({ mode: "normal", typed: ["g"] }, () => false);
  waiting[3]!(panel);
  await plain;
  assert.deepEqual(released, ["released"], "a page-drawn answer has nothing to take down");
});
