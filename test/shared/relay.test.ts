import assert from "node:assert/strict";
import { test } from "node:test";
import { relay_plan } from "../../src/shared/relay.ts";

test("a drawing handler goes to the top frame, with the sender's frame added", () => {
  assert.deepEqual(relay_plan({ type: "relay", to: "top", id: "whichkey.draw", args: { seq: 1 } }, 5), { frame_id: 0, invocation: { id: "whichkey.draw", args: { seq: 1, from_frame: 5 }, bundle: "whichkey" } });
});

test("a frame handler goes to the frame it names, and never to the top by name", () => {
  assert.deepEqual(relay_plan({ type: "relay", to: 5, id: "cmdline.focus", args: { text: "a" } }, 0)?.frame_id, 5);
  assert.equal(relay_plan({ type: "relay", to: "top", id: "cmdline.focus", args: {} }, 5), undefined);
  assert.equal(relay_plan({ type: "relay", to: -1, id: "cmdline.focus", args: {} }, 0), undefined);
  assert.equal(relay_plan({ type: "relay", to: 1.5, id: "cmdline.focus", args: {} }, 0), undefined);
});

test("a drawing handler aimed at a frame id is refused, so no frame draws in another child", () => {
  assert.equal(relay_plan({ type: "relay", to: 3, id: "ui.toast", args: {} }, 5), undefined);
});

test("a handler off the list, an inherited name and bad args are refused", () => {
  assert.equal(relay_plan({ type: "relay", to: "top", id: "open.url", args: {} }, 5), undefined);
  assert.equal(relay_plan({ type: "relay", to: "top", id: "toString", args: {} }, 5), undefined);
  assert.equal(relay_plan({ type: "relay", to: "top", id: "ui.toast", args: [] as never }, 5), undefined);
  assert.equal(relay_plan({ type: "relay", to: "top", id: "ui.toast", args: null as never }, 5), undefined);
  assert.equal(relay_plan({ type: "relay", to: "top", id: "ui.toast", args: {} }, undefined), undefined);
});

test("a frame cannot name another frame as the sender", () => {
  assert.equal(relay_plan({ type: "relay", to: "top", id: "cmdline.token", args: { token: "a", from_frame: 9 } }, 5)?.invocation.args?.from_frame, 5);
});
