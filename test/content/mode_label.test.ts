import assert from "node:assert/strict";
import { test } from "node:test";
import { mode_label } from "../../src/content/ui/mode_label.ts";

test("mode label follows the mode_indicator setting", () => {
  assert.equal(mode_label("normal", false, "always", undefined), "NORMAL");
  assert.equal(mode_label("normal", false, "not_normal", undefined), undefined);
  assert.equal(mode_label("insert", false, "always", undefined), "INSERT");
  assert.equal(mode_label("insert", false, "not_normal", undefined), "INSERT");
  assert.equal(mode_label("ignore", false, "not_normal", undefined), "IGNORE");
  assert.equal(mode_label("normal", true, "always", undefined), "PASS");
  assert.equal(mode_label("normal", true, "not_normal", undefined), "PASS");
  assert.equal(mode_label("hint", false, "always", undefined), undefined);
  assert.equal(mode_label("cmdline", false, "always", undefined), undefined);
  assert.equal(mode_label("caret", false, "always", undefined), "CARET");
  assert.equal(mode_label("visual", false, "not_normal", undefined), "VISUAL");
  assert.equal(mode_label("visual_line", false, "not_normal", undefined), "V-LINE");
  assert.equal(mode_label("insert", false, "off", undefined), undefined);
  assert.equal(mode_label("normal", true, "off", undefined), undefined);
});

test("the badge adds the register to the mode, even where the setting hides the mode", () => {
  assert.equal(mode_label("normal", false, "always", "a"), "NORMAL recording @a");
  assert.equal(mode_label("normal", false, "not_normal", "a"), "recording @a");
  assert.equal(mode_label("normal", false, "off", "a"), "recording @a");
  assert.equal(mode_label("normal", false, "always", undefined), "NORMAL");
  assert.equal(mode_label("insert", false, "off", undefined), undefined);
});
