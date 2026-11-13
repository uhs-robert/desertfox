import assert from "node:assert/strict";
import { test } from "node:test";
import { answer_toolbar_request, create_toolbar, OFF_KEYMAP, plan_site_edit, site_pattern, site_state, toolbar_look } from "../../src/background/toolbar.ts";
import type { ToolbarDeps } from "../../src/background/toolbar.ts";
import { NO_EDITS } from "../../src/shared/config.ts";
import type { MergedConfig } from "../../src/shared/config.ts";
import { create_matcher } from "../../src/shared/keys/matcher.ts";

function fake_toolbar(overrides: Partial<ToolbarDeps> = {}, start_disabled = false) {
  const log: string[] = [];
  let disabled = start_disabled;
  const deps: ToolbarDeps = {
    read_disabled: async () => disabled,
    write_disabled: async (next) => void ((disabled = next), log.push(`flag ${next}`)),
    set_look: async (look) => void log.push(`look ${look.path} ${look.title}`),
    republish: async () => void log.push(`republish ${disabled}`),
    tabs: async () => [{ tab_id: 1, url: "https://ignored.example/" }, { tab_id: 2, url: "https://other.example/" }],
    set_tab_mode: async (tab_id, mode) => void log.push(`mode ${tab_id} ${mode}`),
    ...overrides,
  };
  return { toolbar: create_toolbar(deps), log, is_disabled: () => disabled };
}

test("the icon and title follow the flag", () => {
  assert.deepEqual(toolbar_look(false), { path: "icons/desertfox.svg", title: "DesertFox" });
  assert.deepEqual(toolbar_look(true), { path: "icons/desertfox-off.svg", title: "DesertFox (off)" });
});

test("a background that starts with the flag set restores the grey icon", async () => {
  const { toolbar, log } = fake_toolbar({}, true);
  await toolbar.sync_look();
  assert.deepEqual(log, ["look icons/desertfox-off.svg DesertFox (off)"]);
});

test("the empty keymap matches no key and hides the badge", () => {
  assert.deepEqual(OFF_KEYMAP.modes, {});
  assert.equal(OFF_KEYMAP.off, true);
  assert.equal(OFF_KEYMAP.mode_indicator, "off");
  assert.equal(OFF_KEYMAP.site_rules, undefined);
  for (const mode of ["normal", "insert", "hint", "cmdline"]) assert.equal(create_matcher(OFF_KEYMAP).feed(mode, "j").kind, "no_match");
});

test("turning off stores the flag, republishes, greys the icon and sends every tab to normal mode", async () => {
  const { toolbar, log } = fake_toolbar();
  await toolbar.set_disabled(true);
  assert.deepEqual(log, ["flag true", "republish true", "look icons/desertfox-off.svg DesertFox (off)", "mode 1 normal", "mode 2 normal"]);
});

test("turning on republishes and sends no mode, since the content script enters ignore mode from the tree", async () => {
  const { toolbar, log } = fake_toolbar({}, true);
  await toolbar.set_disabled(false);
  assert.deepEqual(log, ["flag false", "republish false", "look icons/desertfox.svg DesertFox"]);
});

test("a tab without a content script does not stop the others", async () => {
  const { toolbar, log } = fake_toolbar({
    set_tab_mode: async (tab_id, mode) => {
      if (tab_id === 1) throw new Error("no receiver");
      log.push(`mode ${tab_id} ${mode}`);
    },
  });
  await toolbar.set_disabled(true);
  assert.ok(log.includes("mode 2 normal"));
});

test("a failed republish restores the flag and leaves the icon", async () => {
  const { toolbar, log, is_disabled } = fake_toolbar({
    republish: async () => {
      throw new Error("publish failed");
    },
  });
  await assert.rejects(toolbar.set_disabled(true), /publish failed/);
  assert.equal(is_disabled(), false);
  assert.ok(!log.some((entry) => entry.startsWith("look")));
});

test("the shortcut and the popup racing end in a state both asked for, one after the other", async () => {
  const { toolbar, is_disabled, log } = fake_toolbar();
  // Shortcut toggle, popup says off, shortcut toggle again, all at once.
  await Promise.all([toolbar.toggle(), toolbar.set_disabled(true), toolbar.toggle()]);
  // on -> off (toggle), off (popup, already off: no change), off -> on (toggle)
  assert.equal(is_disabled(), false);
  const flags = log.filter((entry) => entry.startsWith("flag"));
  assert.deepEqual(flags, ["flag true", "flag false"]);
  // Each change finishes before the next starts.
  const first_off = log.indexOf("look icons/desertfox-off.svg DesertFox (off)");
  assert.ok(first_off < log.lastIndexOf("flag false"));
});

test("two toggles in a row return to the start", async () => {
  const { toolbar, is_disabled } = fake_toolbar();
  await Promise.all([toolbar.toggle(), toolbar.toggle()]);
  assert.equal(is_disabled(), false);
  await Promise.all([toolbar.toggle(), toolbar.toggle(), toolbar.toggle()]);
  assert.equal(is_disabled(), true);
});

test("a failed change does not block the next one", async () => {
  let fail = true;
  const { toolbar, is_disabled } = fake_toolbar({
    republish: async () => {
      if (fail) throw new Error("once");
    },
  });
  await assert.rejects(toolbar.toggle());
  fail = false;
  await toolbar.toggle();
  assert.equal(is_disabled(), true);
});

test("the site pattern drops www and keeps subdomains, and only web pages have one", () => {
  assert.equal(site_pattern("https://www.example.com/a?b=1"), "*://*.example.com/*");
  assert.equal(site_pattern("http://docs.example.com:8080/"), "*://*.docs.example.com/*");
  assert.equal(site_pattern("https://www.com/"), "*://*.www.com/*");
  assert.equal(site_pattern("http://localhost:3000/"), "*://*.localhost/*");
  assert.equal(site_pattern("about:preferences"), undefined);
  assert.equal(site_pattern("moz-extension://abc/home.html"), undefined);
  assert.equal(site_pattern("file:///tmp/a.html"), undefined);
  assert.equal(site_pattern(undefined), undefined);
  assert.equal(site_pattern("not a url"), undefined);
});

const www_url = "https://www.example.com/page";

const rule_list = (...sites: string[]) => sites.map((site) => ({ site }));

test("the site state tells enabled, disabled, covered by a rule and no site", () => {
  const pattern = "*://*.example.com/*";
  const off = [{ site: pattern, off: true }];
  assert.deepEqual(site_state(www_url, { file: [], saved: undefined, effective: [] }), { kind: "enabled", pattern });
  assert.deepEqual(site_state(www_url, { file: [], saved: off, effective: off }), { kind: "disabled", pattern, rule: "all off" });
  // A bare off row loads as off, and a click still removes it.
  assert.deepEqual(site_state(www_url, { file: [], saved: rule_list(pattern), effective: rule_list(pattern) }), { kind: "disabled", pattern, rule: "all off" });
  assert.equal(site_state(www_url, { file: rule_list("*://www.example.com/*"), saved: undefined, effective: rule_list("*://www.example.com/*") }).kind, "config");
  // The saved list copied a file rule that matches: only the file can undo it.
  assert.equal(site_state(www_url, { file: off, saved: off, effective: off }).kind, "config");
  assert.equal(site_state("about:blank", { file: [], saved: undefined, effective: [] }).kind, "unavailable");
});

test("a key rule describes itself and leaves the site free to turn off", () => {
  const pass = [{ site: "*://*.example.com/*", pass: "j k <C-d>" }];
  assert.deepEqual(site_state(www_url, { file: pass, saved: undefined, effective: pass }), { kind: "enabled", pattern: "*://*.example.com/*", rule: "pass 3 keys" });
  const only = [{ site: "*://*.example.com/*", only: "gg" }];
  assert.equal((site_state(www_url, { file: only, saved: undefined, effective: only }) as { rule: string }).rule, "only 1 key");
  // The popup's off row below the key row decides the off column, and a click removes it again.
  const both = [...pass, { site: "*://*.example.com/*", off: true }];
  assert.deepEqual(site_state(www_url, { file: pass, saved: both, effective: both }), { kind: "disabled", pattern: "*://*.example.com/*", rule: "all off" });
});

test("an off = false row covers the site, and so does a file off row behind the popup's row", () => {
  const kept = [{ site: "*://www.example.com/*", off: false }, { site: "*://*.example.com/*", pass: "j" }];
  assert.deepEqual(site_state(www_url, { file: kept, saved: undefined, effective: kept }), { kind: "config", pattern: "*://*.example.com/*", rule: "on, pass 1 key" });
  const file = [{ site: "*://www.example.com/*", off: true }];
  const effective = [{ site: "*://*.example.com/*", off: true }, ...file];
  assert.equal(site_state(www_url, { file, saved: effective, effective }).kind, "config");
});

test("each column comes from the first matching row that sets it", () => {
  const effective = [{ site: "*://www.example.com/*", pass: "j" }, { site: "*://*.example.com/*" }];
  assert.equal((site_state(www_url, { file: effective, saved: undefined, effective }) as { rule: string }).rule, "all off");
  const keys = [{ site: "*://www.example.com/*", pass: "j" }, { site: "*://*.example.com/*", only: "k" }];
  assert.equal((site_state(www_url, { file: keys, saved: undefined, effective: keys }) as { rule: string }).rule, "pass 1 key");
});

const config_with = (site_rules: { site: string }[]) => ({ settings: { site_rules } }) as unknown as MergedConfig;

test("disabling a site appends an off row to the list in force, enabling removes it", () => {
  const pattern = "*://*.example.com/*";
  const file = [{ site: "*://file.test/*", pass: "j" }];
  const disabled = plan_site_edit(NO_EDITS, file, pattern, "disable");
  assert.deepEqual(disabled?.saved.site_rules, [...file, { site: pattern, off: true }]);
  const enabled = plan_site_edit(disabled!, file, pattern, "enable");
  assert.deepEqual(enabled?.saved.site_rules, file);
  assert.equal(plan_site_edit(disabled!, [], pattern, "disable"), undefined);
  assert.equal(plan_site_edit(NO_EDITS, [], pattern, "enable"), undefined);
  // Enabling also removes the bare off row, and keeps a row for the pattern that sets keys.
  // A user row that is off and also binds keys is no popup row, so enabling the site keeps it.
  const with_bind = { site: pattern, off: true, bind: { j: { id: "page.send_key", args: { key: "ArrowDown", key_code: 40 } } } };
  assert.equal(plan_site_edit({ saved: { site_rules: [with_bind] }, temp: {} }, [], pattern, "enable"), undefined);
  const older = { saved: { site_rules: [{ site: pattern }, { site: pattern, pass: "j" }] }, temp: {} };
  assert.deepEqual(plan_site_edit(older, [], pattern, "enable")?.saved.site_rules, [{ site: pattern, pass: "j" }]);
});

test("the popup messages go to the switch, the edits and the reload, and a bad request is refused", async () => {
  const calls: string[] = [];
  const deps = {
    toolbar: { set_disabled: async (disabled: boolean) => void calls.push(`set ${disabled}`) },
    change_edits: async (decide: (current: typeof NO_EDITS, config: MergedConfig) => unknown) => void calls.push(`edit ${JSON.stringify(decide(NO_EDITS, config_with([])))}`),
    read_file_site_rules: async () => [],
    reload_config: async () => ({ config_dir: "/c", warnings: 1 }),
  };
  assert.deepEqual(await answer_toolbar_request({ type: "toolbar_set_disabled", disabled: true }, deps), { ok: true, message: "DesertFox is off" });
  assert.equal((await answer_toolbar_request({ type: "toolbar_set_disabled", disabled: "yes" as never }, deps)).ok, false);
  assert.equal((await answer_toolbar_request({ type: "toolbar_site", url: www_url, action: "disable" }, deps)).ok, true);
  assert.equal((await answer_toolbar_request({ type: "toolbar_site", url: "about:blank", action: "disable" }, deps)).ok, false);
  assert.equal((await answer_toolbar_request({ type: "toolbar_site", url: www_url, action: "drop" as never }, deps)).ok, false);
  assert.deepEqual(await answer_toolbar_request({ type: "toolbar_reload_config" }, deps), { ok: true, message: "Reloaded /c, 1 warning" });
  const failing = { ...deps, reload_config: async () => { throw new Error("no host"); } };
  assert.deepEqual(await answer_toolbar_request({ type: "toolbar_reload_config" }, failing), { ok: false, message: "no host" });
  assert.deepEqual(calls, ["set true", 'edit {"saved":{"site_rules":[{"site":"*://*.example.com/*","off":true}]},"temp":{}}']);
});

test("a request for the state already in force changes nothing", async () => {
  const { toolbar, log } = fake_toolbar({}, true);
  await toolbar.set_disabled(true);
  assert.deepEqual(log, []);
  const on = fake_toolbar();
  await on.toolbar.set_disabled(false);
  assert.deepEqual(on.log, []);
});

test("the start-up icon waits for a change in flight", async () => {
  const { toolbar, log } = fake_toolbar();
  const change = toolbar.set_disabled(true);
  await toolbar.sync_look();
  await change;
  assert.equal(log.filter((entry) => entry.startsWith("look")).at(-1), "look icons/desertfox-off.svg DesertFox (off)");
});

test("disabling a site seeds the saved list from the file, not from a temp edit", () => {
  const current = { saved: {}, temp: { site_rules: [{ site: "*://temp.test/*" }] } };
  const next = plan_site_edit(current, rule_list("*://file.test/*"), "*://*.a.test/*", "disable");
  assert.deepEqual(next?.saved.site_rules, [{ site: "*://file.test/*" }, { site: "*://*.a.test/*", off: true }]);
});
