import assert from "node:assert/strict";
import { test } from "node:test";
import { choose_align_target } from "../src/content/align_target.ts";
import "../src/commands/scroll.ts";
import { check_args, registry } from "../src/shared/registry/index.ts";

const focus = (ref: string) => ({ ref, is_page_root: false });
const page_root = (ref: string) => ({ ref, is_page_root: true });

test("the focused element wins over the selection", () => {
  assert.equal(choose_align_target(focus("field"), { editable: undefined, parent: "paragraph", holds_remembered: false }, "left"), "field");
});

test("body and html are skipped, so the selection is used", () => {
  assert.equal(choose_align_target(page_root("body"), { editable: undefined, parent: "paragraph", holds_remembered: false }, undefined), "paragraph");
});

test("a selection inside an editable uses the editable", () => {
  assert.equal(choose_align_target(undefined, { editable: "editor", parent: "line", holds_remembered: false }, "left"), "editor");
});

test("nothing focused or selected gives no target", () => {
  assert.equal(choose_align_target(undefined, undefined, undefined), undefined);
  assert.equal(choose_align_target(page_root("html"), undefined, undefined), undefined);
});

test("the blurred element is the last resort, after focus and selection", () => {
  assert.equal(choose_align_target(undefined, undefined, "left"), "left");
  assert.equal(choose_align_target(page_root("body"), undefined, "left"), "left");
  assert.equal(choose_align_target(undefined, { editable: undefined, parent: "paragraph", holds_remembered: false }, "left"), "paragraph");
  assert.equal(choose_align_target(focus("field"), undefined, "left"), "field");
});

test("a selection on the field's wrapper gives way to the blurred field inside it", () => {
  assert.equal(choose_align_target(undefined, { editable: undefined, parent: "wrapper", holds_remembered: true }, "field"), "field");
});

test("scroll.align defaults to center and refuses an unknown position", () => {
  const align = registry.get("scroll.align")!;
  assert.equal(align.name, undefined);
  assert.deepEqual(check_args(align, undefined), { ok: true, args: { position: "center" } });
  assert.deepEqual(check_args(align, { position: "top" }), { ok: true, args: { position: "top" } });
  assert.equal(check_args(align, { position: "middle" }).ok, false);
});
