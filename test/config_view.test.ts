import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../src/shared/config.ts";
import { build_config_view } from "../src/help/config_view.ts";

const NO_LAYERS = { saved: [], temp: [], configured: [] };

test("each source has its own text", () => {
  const texts = (["files", "defaults"] as const).map(
    (source) => build_config_view({ source, settings: DEFAULT_SETTINGS, ...NO_LAYERS }).source_text,
  );
  assert.equal(new Set(texts).size, 2);
  assert.match(texts[0]!, /files/);
  assert.match(texts[1]!, /defaults/);
});

test("a stored source this version dropped, such as managed, reads as unknown and does not throw", () => {
  const stale = { source: "managed", settings: DEFAULT_SETTINGS, managed_file_hint: "x", ...NO_LAYERS } as never;
  const view = build_config_view(stale);
  assert.match(view.source_text, /Unknown/);
  assert.equal(view.rebuild_steps.length, 2);
});

test("a missing status says the source is unknown", () => {
  assert.match(build_config_view(undefined).source_text, /Unknown/);
});

test("the steps to apply an edit name the host install and config.reload, whatever the source", () => {
  for (const source of ["files", "defaults"] as const) {
    const steps = build_config_view({ source, settings: DEFAULT_SETTINGS, ...NO_LAYERS }).rebuild_steps;
    assert.match(steps[0]!, /native\.install/);
    assert.match(steps[1]!, /config\.reload.*qr/);
  }
});
