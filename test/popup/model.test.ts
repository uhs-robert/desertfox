import assert from "node:assert/strict";
import { test } from "node:test";
import { create_notice, disabled_after_click, host_dot, release_url, rule_template, site_card, theme_options, NOTICE_MS, SUPPORT_URL, COMMANDS_HASH, EDIT_FILES_HASH, HOME_HASH, SETTINGS_HASH, SITE_RULES_HASH, WARNINGS_HASH, build_rows } from "../../src/popup/model.ts";
import type { PopupInputs } from "../../src/popup/model.ts";
import { parse_route } from "../../src/help/route.ts";

const base: PopupInputs = { disabled: false, site: { kind: "enabled", pattern: "*://*.a.test/*" }, warning_count: 2, version: "1.2.3", has_native_host: true, host_connected: false, extra_theme_names: [], theme: "oasis_moonlight" };
const ids = (inputs: PopupInputs) => build_rows(inputs).map((row) => row.id);
const row = (inputs: PopupInputs, id: string) => build_rows(inputs).find((candidate) => candidate.id === id)!;

test("the first row is the switch and the rows follow the layout: switch, site card, links", () => {
  assert.deepEqual(ids(base), ["power", "site", "copy_rule", "reload_config", "settings", "home", "keys", "warnings", "support"]);
  assert.ok(!ids({ ...base, warning_count: 0 }).includes("warnings"), "no Warnings row without warnings");
  assert.equal(ids({ ...base, warning_count: 0 }).at(-1), "support");
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
  assert.deepEqual([row(config, "site").enabled, row(config, "site").detail], [false, "A rule covers it"]);
  assert.equal(row({ ...base, site: { kind: "unavailable" } }, "site").enabled, false);
});

test("a rule on the page shows its summary and links to the settings page", () => {
  assert.ok(!ids(base).includes("rule"));
  // A key rule leaves the site row live and still shows.
  const keys = { ...base, site: { kind: "enabled", pattern: "p", rule: "pass 1 key" } } as const;
  assert.equal(row(keys, "rule").detail, "Pass 1 key");
  assert.equal(row(keys, "site").enabled, true);
  const config = { ...base, site: { kind: "config", pattern: "p", rule: "pass 3 keys" } } as const;
  assert.deepEqual(row(config, "rule"), { id: "rule", kind: "link", label: "Rule on this page", detail: "Pass 3 keys", enabled: true });
});

test("reload config is an action button, not a link", () => {
  assert.equal(row(base, "reload_config").kind, "action");
  assert.equal(row(base, "reload_config").enabled, true);
});

test("reload config greys out without the native host", () => {
  assert.equal(row({ ...base, has_native_host: false }, "reload_config").enabled, false);
  assert.equal(row({ ...base, has_native_host: false }, "reload_config").detail, "Needs the native host");
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

test("the rule line URL names the site rules anchor, which the settings page draws at render", async () => {
  assert.equal(SITE_RULES_HASH, "#section=settings/site-rules");
  const route = parse_route(SITE_RULES_HASH);
  assert.deepEqual(route, { page: "settings", section: "site-rules" });
  const { SITE_RULES_SLUG, section_anchor } = await import("../../src/help/render.ts");
  assert.equal(route.section, SITE_RULES_SLUG);
  assert.equal(section_anchor("settings", route.section!), "settings-site-rules");
});

test("the site card names the host and one state line", () => {
  assert.deepEqual(site_card(base.site, false), { host: "a.test", state: "Enabled on this site" });
  assert.equal(site_card({ kind: "disabled", pattern: "*://*.a.test/*" }, false).state, "Disabled on this site");
  assert.equal(site_card({ kind: "config", pattern: "*://*.a.test/*" }, false).state, "A rule covers this site");
  assert.equal(site_card(base.site, true).state, "DesertFox is off");
  assert.deepEqual(site_card({ kind: "unavailable" }, false), { host: "This page", state: "No site on this page" });
});

test("the copy rule row shows only for a page with a site, and the text is a rule with an empty pass", () => {
  assert.ok(ids(base).includes("copy_rule"));
  assert.ok(!ids({ ...base, site: { kind: "unavailable" } }).includes("copy_rule"));
  assert.equal(rule_template("*://*.a.test/*"), '[[site_rules]]\nsite = "*://*.a.test/*"\npass = ""\n');
});

test("the copy rule jump lands on the edit files section, and the Keys button on the Commands page", async () => {
  assert.deepEqual(parse_route(EDIT_FILES_HASH), { page: "settings", section: "advanced-edit-files" });
  assert.deepEqual(parse_route(COMMANDS_HASH), { page: "commands" });
  const { sections_from_titles } = await import("../../src/help/render.ts");
  assert.equal(sections_from_titles(["Advanced: edit files"])[0]!.slug, "advanced-edit-files");
  assert.equal(row(base, "keys").kind, "link");
});

test("the version links to its tag for a release and to the list for a beta", () => {
  assert.equal(release_url("1.0.0"), "https://github.com/uhs-robert/desertfox/releases/tag/v1.0.0");
  assert.equal(release_url("1.0.0.53"), "https://github.com/uhs-robert/desertfox/releases");
});

test("the theme list holds built-in, local and imported themes once each, with the one in force", () => {
  const names = theme_options("desktop", ["mine", "oasis_dune", "imported"]);
  assert.ok(theme_options("dracula", []).includes("desktop"), "desktop stays on offer after another theme is picked");
  assert.ok(names.includes("catppuccin") && names.includes("mine") && names.includes("imported") && names.includes("desktop"));
  assert.equal(names.filter((name) => name === "oasis_dune").length, 1);
  assert.deepEqual(names, [...names].sort());
});

test("the host dot says permission, connected or not connected", () => {
  assert.deepEqual(host_dot(false, true), { connected: false, label: "Native host: no permission" });
  assert.deepEqual(host_dot(true, true), { connected: true, label: "Native host: connected" });
  assert.deepEqual(host_dot(true, false), { connected: false, label: "Native host: not connected" });
});

function fake_timers() {
  const timers: { run: () => void; delay_ms: number; cancelled: boolean }[] = [];
  let redraws = 0;
  const notice = create_notice({
    after: (run, delay_ms) => {
      const timer = { run, delay_ms, cancelled: false };
      timers.push(timer);
      return () => void (timer.cancelled = true);
    },
    changed: () => void (redraws += 1),
  });
  return { notice, timers, redraws: () => redraws };
}

test("a success notice clears after 4 seconds and asks for a redraw", () => {
  const { notice, timers, redraws } = fake_timers();
  notice.show({ ok: true, message: "Reloaded" });
  assert.equal(notice.text(), "Reloaded");
  assert.equal(timers[0]!.delay_ms, NOTICE_MS);
  assert.equal(NOTICE_MS, 4000);
  timers[0]!.run();
  assert.equal(notice.text(), "");
  assert.equal(redraws(), 1);
});

test("an error notice sets no timer and stays until the next notice", () => {
  const { notice, timers } = fake_timers();
  notice.show({ ok: false, message: "no host" });
  assert.deepEqual(timers, []);
  assert.equal(notice.text(), "no host");
});

test("an older timer never clears a newer notice, even one that fires late", () => {
  const { notice, timers, redraws } = fake_timers();
  notice.show({ ok: true, message: "first" });
  notice.show({ ok: true, message: "second" });
  assert.equal(timers[0]!.cancelled, true);
  timers[0]!.run();
  assert.equal(notice.text(), "second");
  assert.equal(redraws(), 0);
  notice.show({ ok: false, message: "failed" });
  timers[1]!.run();
  assert.equal(notice.text(), "failed");
  assert.equal(redraws(), 0);
});
