import assert from "node:assert/strict";
import { test } from "node:test";
import { disabled_after_click, HOME_HASH, SETTINGS_HASH, WARNINGS_HASH, build_rows } from "../../src/popup/model.ts";
import type { PopupInputs } from "../../src/popup/model.ts";
import { parse_route } from "../../src/help/route.ts";

const base: PopupInputs = { disabled: false, site: { kind: "enabled", pattern: "*://*.a.test/*" }, warning_count: 2, version: "1.2.3", has_native_host: true, site_changed: false };
const ids = (inputs: PopupInputs) => build_rows(inputs).map((row) => row.id);
const row = (inputs: PopupInputs, id: string) => build_rows(inputs).find((candidate) => candidate.id === id)!;

test("the first row is the switch and the rows follow the owner's order", () => {
  assert.deepEqual(ids(base), ["power", "settings", "home", "site", "reload_config", "warnings", "version"]);
  assert.deepEqual(row(base, "power"), { id: "power", kind: "switch", label: "DesertFox is on", enabled: true, on: true });
  assert.equal(row({ ...base, disabled: true }, "power").label, "DesertFox is off");
  assert.equal(row({ ...base, disabled: true }, "power").on, false);
});

test("the site row flips with the state and greys out while off or where a file sets it", () => {
  assert.equal(row(base, "site").label, "Disable on this site");
  assert.equal(row(base, "site").enabled, true);
  const disabled = { ...base, site: { kind: "disabled", pattern: "p" } } as const;
  assert.equal(row(disabled, "site").label, "Enable on this site");
  assert.equal(row(disabled, "site").site_action, "enable");
  assert.equal(row({ ...disabled, disabled: true }, "site").enabled, false);
  assert.equal(row({ ...base, disabled: true }, "site").detail, "DesertFox is off");
  const config = { ...base, site: { kind: "config", pattern: "p" } } as const;
  assert.deepEqual([row(config, "site").enabled, row(config, "site").detail], [false, "set in config"]);
  assert.equal(row({ ...base, site: { kind: "unavailable" } }, "site").enabled, false);
});

test("reload config greys out without the native host, a site change offers a tab reload", () => {
  assert.equal(row({ ...base, has_native_host: false }, "reload_config").enabled, false);
  assert.equal(row({ ...base, has_native_host: false }, "reload_config").detail, "needs the native host");
  assert.ok(!ids(base).includes("reload_tab"));
  assert.ok(ids({ ...base, site_changed: true }).includes("reload_tab"));
});

test("the warnings row counts and the version row shows the manifest version", () => {
  assert.equal(row(base, "warnings").label, "Warnings (2)");
  assert.equal(row(base, "version").label, "Version 1.2.3");
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
