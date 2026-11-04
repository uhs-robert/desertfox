import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "../src/shared/config.ts";
import { build_options_model } from "../src/options/model.ts";

const hint = "~/.mozilla/managed-storage/oasisfox@uhs-robert.json";

test("each source has its own text", () => {
  const texts = (["managed", "imported", "defaults"] as const).map(
    (source) => build_options_model({ source, settings: DEFAULT_SETTINGS, managed_file_hint: hint }, []).source_text,
  );
  assert.equal(new Set(texts).size, 3);
  assert.match(texts[0]!, /Managed/);
});

test("a missing status shows defaults and says the source is unknown", () => {
  const model = build_options_model(undefined, []);
  assert.match(model.source_text, /Unknown/);
  assert.ok(model.settings.some((row) => row.name === "mode_indicator" && row.value === "\"always\""));
});

test("settings rows render any setting, including one the model does not know", () => {
  const settings = { ...DEFAULT_SETTINGS, mode_palette: "moonlight", flag: true } as typeof DEFAULT_SETTINGS;
  const rows = build_options_model({ source: "managed", settings, managed_file_hint: hint }, []).settings;
  assert.deepEqual(rows.find((row) => row.name === "mode_palette"), { name: "mode_palette", value: "\"moonlight\"" });
  assert.deepEqual(rows.find((row) => row.name === "flag"), { name: "flag", value: "true" });
  assert.deepEqual(rows.find((row) => row.name === "which_key_delay_ms"), { name: "which_key_delay_ms", value: "300" });
  assert.deepEqual(rows.find((row) => row.name === "ignore_sites"), { name: "ignore_sites", value: "[]" });
});

test("warnings are listed and keymap warnings are counted", () => {
  const warnings = ["normal: skipped \"x\": bad", "browser: skipped \"y\": bad", "config (managed): skipped, format_version 2 is not 1"];
  const model = build_options_model({ source: "managed", settings: DEFAULT_SETTINGS, managed_file_hint: hint }, warnings);
  assert.deepEqual(model.warnings, warnings);
  assert.equal(model.keymap_warning_count, 2);
});

test("the rebuild steps name the command, the managed file and config.reload", () => {
  const steps = build_options_model({ source: "managed", settings: DEFAULT_SETTINGS, managed_file_hint: "/x/y.json" }, []).rebuild_steps;
  assert.equal(steps[0], "just build-config");
  assert.match(steps[1]!, /\/x\/y\.json/);
  assert.match(steps[2]!, /config\.reload.*qr/);
  assert.match(build_options_model(undefined, []).rebuild_steps[1]!, /oasisfox@uhs-robert\.json/);
});

test("the status page lists every command with its id, label and intent, sorted by id", () => {
  const meta = (id: string, label: string, intent: string) => ({ id, label, intent, name: id, runs_in: "background" as const });
  const model = build_options_model(undefined, [], [meta("tab.next", "Next Tab", "Go to the next tab."), meta("open.url", "Open URL", "Open a URL.")]);
  assert.deepEqual(model.commands, [
    { id: "open.url", label: "Open URL", intent: "Open a URL." },
    { id: "tab.next", label: "Next Tab", intent: "Go to the next tab." },
  ]);
});

test("a value that differs from the default is tagged with where it came from", () => {
  const settings = { ...DEFAULT_SETTINGS, which_key_delay_ms: 500, hint_letters: "ab", palette: DEFAULT_SETTINGS.palette };
  const status = { source: "managed" as const, settings, managed_file_hint: hint, overrides: ["which_key_delay_ms", "palette"], configured: ["which_key_delay_ms", "hint_letters", "palette"] };
  const rows = build_options_model(status, []).settings;
  const tag = (name: string) => rows.find((row) => row.name === name)?.tag;
  assert.equal(tag("which_key_delay_ms"), "set");
  assert.equal(tag("hint_letters"), "settings.toml");
  // Equal to the default, so no tag even though both sources name it.
  assert.equal(tag("palette"), undefined);
  assert.equal(tag("which_key_border"), undefined);
});

test("an optional true or false setting equal to what an absent one reads as is not tagged", () => {
  const settings = { ...DEFAULT_SETTINGS, newtab_date: true, completion_all_windows: true };
  const status = { source: "managed" as const, settings, managed_file_hint: hint, overrides: ["newtab_date", "completion_all_windows"], configured: ["newtab_date"] };
  const rows = build_options_model(status, []).settings;
  assert.equal(rows.find((row) => row.name === "newtab_date")?.tag, undefined);
  assert.equal(rows.find((row) => row.name === "completion_all_windows")?.tag, "set");
});
