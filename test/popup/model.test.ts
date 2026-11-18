import assert from "node:assert/strict";
import { test } from "node:test";
import { disabled_after_click, site_card, SUPPORT_URL, HOME_HASH, SETTINGS_HASH, SITE_RULES_HASH, WARNINGS_HASH, build_rows } from "../../src/popup/model.ts";
import type { PopupInputs } from "../../src/popup/model.ts";
import { parse_route } from "../../src/help/route.ts";

const base: PopupInputs = { disabled: false, site: { kind: "enabled", pattern: "*://*.a.test/*" }, warning_count: 2, version: "1.2.3", has_native_host: true };
const ids = (inputs: PopupInputs) => build_rows(inputs).map((row) => row.id);
const row = (inputs: PopupInputs, id: string) => build_rows(inputs).find((candidate) => candidate.id === id)!;

test("the first row is the switch and the rows follow the layout: switch, site card, links", () => {
  assert.deepEqual(ids(base), ["power", "site", "settings", "home", "support", "reload_config", "warnings"]);
  assert.deepEqual(row(base, "power"), { id: "power", kind: "switch", label: "DesertFox is on", enabled: true, on: true });
  assert.equal(row({ ...base, disabled: true }, "power").label, "DesertFox is off");
  assert.equal(row({ ...base, disabled: true }, "power").on, false);
});

test("the site row flips with the state and greys out while off or where a file sets it", () => {
  assert.equal(row(base, "site").label, "Disable on this site");
  assert.equal(row(base, "site").enabled, true);
  const disabled = { ...base, site: { kind: "disabled", pattern: "p", rule: "all off" } } as const;
  assert.equal(row(disabled, "site").label, "Enable on this site");
  assert.equal(row(disabled, "site").site_action, "enable");
  assert.equal(row({ ...disabled, disabled: true }, "site").enabled, false);
  assert.equal(row({ ...base, disabled: true }, "site").detail, "DesertFox is off");
  const config = { ...base, site: { kind: "config", pattern: "p", rule: "pass 3 keys" } } as const;
  assert.deepEqual([row(config, "site").enabled, row(config, "site").detail], [false, "a rule covers it"]);
  assert.equal(row({ ...base, site: { kind: "unavailable" } }, "site").enabled, false);
});

test("a rule on the page shows its summary and links to the settings page", () => {
  assert.ok(!ids(base).includes("rule"));
  // A key rule leaves the site row live and still shows.
  const keys = { ...base, site: { kind: "enabled", pattern: "p", rule: "pass 1 key" } } as const;
  assert.equal(row(keys, "rule").detail, "pass 1 key");
  assert.equal(row(keys, "site").enabled, true);
  const config = { ...base, site: { kind: "config", pattern: "p", rule: "pass 3 keys" } } as const;
  assert.deepEqual(row(config, "rule"), { id: "rule", kind: "link", label: "Rule on this page", detail: "pass 3 keys", enabled: true });
});

test("reload config greys out without the native host", () => {
  assert.equal(row({ ...base, has_native_host: false }, "reload_config").enabled, false);
  assert.equal(row({ ...base, has_native_host: false }, "reload_config").detail, "needs the native host");
});

test("the support row follows Help and links to GitHub Sponsors", () => {
  assert.equal(row(base, "support").label, "Support DesertFox");
  assert.equal(row(base, "support").kind, "link");
  assert.equal(row(base, "support").enabled, true);
  assert.equal(SUPPORT_URL, "https://github.com/sponsors/uhs-robert");
});

test("the warnings row counts", () => {
  assert.equal(row(base, "warnings").label, "Warnings (2)");
});

test("the links land on Home, Settings and the Warnings heading", () => {
  assert.deepEqual(parse_route(HOME_HASH), { page: "home" });
  assert.deepEqual(parse_route(SETTINGS_HASH), { page: "settings" });
  assert.deepEqual(parse_route(WARNINGS_HASH), { page: "home", section: "warnings" });
});

test("a click on the switch asks for the opposite of what it shows", () => {
  assert.equal(disabled_after_click(row(base, "power")), true);
  assert.equal(disabled_after_click(row({ ...base, disabled: true }, "power")), false);
});

test("the rule link lands on the settings group that holds site_rules", async () => {
  const { page_sections } = await import("../../src/help/render.ts");
  const route = parse_route(SITE_RULES_HASH);
  assert.equal(route.page, "settings");
  assert.ok(page_sections("settings", []).some((section) => section.slug === route.section));
});

test("the site card names the host and one state line", () => {
  assert.deepEqual(site_card(base.site, false), { host: "a.test", state: "Enabled on this site" });
  assert.equal(site_card({ kind: "disabled", pattern: "*://*.a.test/*" }, false).state, "Disabled on this site");
  assert.equal(site_card({ kind: "config", pattern: "*://*.a.test/*" }, false).state, "A rule covers this site");
  assert.equal(site_card(base.site, true).state, "DesertFox is off");
  assert.deepEqual(site_card({ kind: "unavailable" }, false), { host: "This page", state: "No site on this page" });
});
