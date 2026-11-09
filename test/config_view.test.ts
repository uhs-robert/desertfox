import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../src/shared/config.ts";
import { build_config_view } from "../src/help/config_view.ts";

const hint = "~/.mozilla/managed-storage/desertfox@uhs-robert.json";
const NO_LAYERS = { saved: [], temp: [], configured: [] };

test("each source has its own text", () => {
  const texts = (["files", "managed", "defaults"] as const).map(
    (source) => build_config_view({ source, settings: DEFAULT_SETTINGS, managed_file_hint: hint, ...NO_LAYERS }).source_text,
  );
  assert.equal(new Set(texts).size, 3);
  assert.match(texts[0]!, /files/);
  assert.match(texts[1]!, /Managed/);
});

test("a missing status says the source is unknown", () => {
  assert.match(build_config_view(undefined).source_text, /Unknown/);
});

test("the steps to apply an edit name the host install and config.reload, whatever the source", () => {
  for (const source of ["files", "managed", "defaults"] as const) {
    const steps = build_config_view({ source, settings: DEFAULT_SETTINGS, managed_file_hint: hint, ...NO_LAYERS }).rebuild_steps;
    assert.match(steps[0]!, /native\.install/);
    assert.match(steps[1]!, /config\.reload.*qr/);
  }
});
