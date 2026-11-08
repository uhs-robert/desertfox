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
    ignore_regex: async () => "^https://ignored\\.example/$",
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
  assert.equal(OFF_KEYMAP.mode_indicator, "off");
  assert.equal(OFF_KEYMAP.ignore_regex, undefined);
  for (const mode of ["normal", "insert", "hint", "cmdline"]) assert.equal(create_matcher(OFF_KEYMAP).feed(mode, "j").kind, "no_match");
});

test("turning off stores the flag, republishes, greys the icon and sends every tab to normal mode", async () => {
  const { toolbar, log } = fake_toolbar();
  await toolbar.set_disabled(true);
  assert.deepEqual(log, ["flag true", "republish true", "look icons/desertfox-off.svg DesertFox (off)", "mode 1 normal", "mode 2 normal"]);
});

test("turning on puts ignored sites back into ignore mode", async () => {
  const { toolbar, log } = fake_toolbar({}, true);
  await toolbar.set_disabled(false);
  assert.deepEqual(log, ["flag false", "republish false", "look icons/desertfox.svg DesertFox", "mode 1 ignore"]);
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

test("the site state tells enabled, disabled, set in config and no site", () => {
  const pattern = "*://*.example.com/*";
  assert.deepEqual(site_state(www_url, { file: [], saved: undefined, effective: [] }), { kind: "enabled", pattern });
  assert.deepEqual(site_state(www_url, { file: [], saved: [pattern], effective: [pattern] }), { kind: "disabled", pattern });
  assert.deepEqual(site_state(www_url, { file: ["*://www.example.com/*"], saved: undefined, effective: ["*://www.example.com/*"] }).kind, "config");
  // The saved list copied a file pattern that matches: only the file can undo it.
  assert.equal(site_state(www_url, { file: [pattern], saved: [pattern], effective: [pattern] }).kind, "config");
  assert.equal(site_state("about:blank", { file: [], saved: undefined, effective: [] }).kind, "unavailable");
});

const config_with = (ignore_sites: string[]) => ({ settings: { ignore_sites } }) as unknown as MergedConfig;

test("disabling a site appends its pattern to the list in force, enabling removes it", () => {
  const pattern = "*://*.example.com/*";
  const disabled = plan_site_edit(NO_EDITS, ["*://file.test/*"], pattern, "disable");
  assert.deepEqual(disabled?.saved.ignore_sites, ["*://file.test/*", pattern]);
  const enabled = plan_site_edit(disabled!, ["*://file.test/*"], pattern, "enable");
  assert.deepEqual(enabled?.saved.ignore_sites, ["*://file.test/*"]);
  assert.equal(plan_site_edit(disabled!, [], pattern, "disable"), undefined);
  assert.equal(plan_site_edit(NO_EDITS, [], pattern, "enable"), undefined);
});

test("the popup messages go to the switch, the edits and the reload, and a bad request is refused", async () => {
  const calls: string[] = [];
  const deps = {
    toolbar: { set_disabled: async (disabled: boolean) => void calls.push(`set ${disabled}`) },
    change_edits: async (decide: (current: typeof NO_EDITS, config: MergedConfig) => unknown) => void calls.push(`edit ${JSON.stringify(decide(NO_EDITS, config_with([])))}`),
    read_file_ignore_sites: async () => [],
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
  assert.deepEqual(calls, ["set true", 'edit {"saved":{"ignore_sites":["*://*.example.com/*"]},"temp":{}}']);
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
  const current = { saved: {}, temp: { ignore_sites: ["*://temp.test/*"] } };
  const next = plan_site_edit(current, ["*://file.test/*"], "*://*.a.test/*", "disable");
  assert.deepEqual(next?.saved.ignore_sites, ["*://file.test/*", "*://*.a.test/*"]);
});
