import assert from "node:assert/strict";
import { test } from "node:test";
import { empty_config } from "../../src/background/config_load.ts";
import { compile_config } from "../../src/background/compile.ts";
import { apply_toolbar_badge, badge_for_config, refresh_toolbar_badges, toolbar_badge } from "../../src/background/toolbar_badge.ts";
import type { BadgeApi } from "../../src/background/toolbar_badge.ts";
import type { Mode } from "../../src/shared/command.ts";
import { PALETTE_NAMES, resolve_mode_colors } from "../../src/shared/mode_colors.ts";

const colors = resolve_mode_colors("moonlight");

function fake_api() {
  const calls: string[] = [];
  const api = {
    setBadgeText: async (d: { tabId?: number; text: string | null }) => void calls.push(`text ${d.tabId} ${d.text}`),
    setBadgeBackgroundColor: async (d: { tabId?: number; color: unknown }) => void calls.push(`bg ${d.tabId} ${String(d.color)}`),
    setBadgeTextColor: async (d: { tabId?: number; color: unknown }) => void calls.push(`fg ${d.tabId} ${String(d.color)}`),
    setTitle: async (d: { tabId?: number; title: string | null }) => void calls.push(`title ${d.tabId} ${d.title}`),
  } as unknown as BadgeApi;
  return { api, calls };
}

test("toolbar text and title per mode under always", () => {
  assert.deepEqual(toolbar_badge("normal", "always", colors, "dark"), { text: "NOR", title: "OasisFox: NORMAL mode", color: ["#7fa3c9", "#0c0e13"] });
  assert.equal(toolbar_badge("insert", "always", colors, "dark")?.text, "INS");
  assert.equal(toolbar_badge("ignore", "always", colors, "dark")?.title, "OasisFox: IGNORE mode");
});

test("not_normal clears only normal, off clears everything, hint and cmdline never show", () => {
  assert.equal(toolbar_badge("normal", "not_normal", colors, "dark"), undefined);
  assert.equal(toolbar_badge("insert", "not_normal", colors, "dark")?.text, "INS");
  for (const mode of ["normal", "insert", "ignore", "hint", "cmdline"] as Mode[]) {
    assert.equal(toolbar_badge(mode, "off", colors, "dark"), undefined);
  }
  assert.equal(toolbar_badge("hint", "always", colors, "dark"), undefined);
  assert.equal(toolbar_badge("cmdline", "always", colors, "dark"), undefined);
});

test("the system theme picks the color variant and ignore uses the muted pair", () => {
  assert.deepEqual(toolbar_badge("normal", "always", colors, "light")?.color, ["#253b53", "#e8e5d8"]);
  assert.deepEqual(toolbar_badge("ignore", "always", colors, "dark")?.color, ["#1e2a38", "#717a84"]);
});

test("apply sets text, title and colors for the given tab, and clearing resets text and title", async () => {
  const { api, calls } = fake_api();
  await apply_toolbar_badge(api, 7, toolbar_badge("insert", "always", colors, "dark"));
  assert.deepEqual(calls.sort(), ["bg 7 #ffa0a0", "fg 7 #0c0e13", "text 7 INS", "title 7 OasisFox: INSERT mode"]);
  calls.length = 0;
  await apply_toolbar_badge(api, 7, undefined);
  assert.deepEqual(calls.sort(), ["text 7 ", "title 7 null"]);
});

test("refresh re-applies each reported tab with the new setting and leaves unreported tabs bare", async () => {
  const { api, calls } = fake_api();
  const modes: Record<number, Mode | undefined> = { 1: "normal", 2: "insert", 3: undefined };
  const deps = { api, tab_ids: async () => [1, 2, 3], reported_mode: async (id: number) => modes[id] };
  await refresh_toolbar_badges(deps, { ...empty_config(), settings: { mode_indicator: "not_normal" } }, "dark");
  assert.ok(calls.includes("text 1 "));
  assert.ok(calls.includes("text 2 INS"));
  assert.ok(calls.includes("text 3 "));
});

test("an unknown palette falls back to moonlight for the toolbar and warns at compile", () => {
  const config = { ...empty_config(), settings: { palette: "nope" as never } };
  assert.equal(badge_for_config("normal", config, "dark")?.color[0], "#7fa3c9");
  const { compiled, warnings } = compile_config({ config, default_keymap: {}, get_command: () => undefined, enum_sources: { search_engines: [], containers: [] } });
  assert.match(warnings.join("\n"), /palette "nope"/);
  assert.deepEqual(compiled.mode_colors, colors);
});

test("every palette resolves to six hex colors", () => {
  for (const name of PALETTE_NAMES) {
    const resolved = resolve_mode_colors(name);
    for (const mode of ["normal", "insert", "ignore"] as const) {
      for (const color of [...resolved[mode].dark, ...resolved[mode].light]) assert.match(color, /^#[0-9a-f]{6}$/);
    }
  }
});
