import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { create_bridge_run, never_listed, opens_url, type BridgeRunTarget } from "../../src/background/bridge_run.ts";
import { focused_normal_target } from "../../src/background/bridge_browser.ts";
import { create_router } from "../../src/background/router.ts";
import { registry as built_in } from "../../src/shared/registry/builtin.ts";
import type { Invocation } from "../../src/shared/invocation.ts";
import { url_target } from "../../src/commands/url_build.ts";
import { make_fake } from "./fakes.ts";

const resolve_url = async (text: string) => url_target(text, "arch", { arch: { url: "https://arch.example/?q={query}" } });

const NORMAL: BridgeRunTarget = { tab_id: 7, window_id: 1, url: "https://example.org/", incognito: false };

// A registry of fake commands that count their runs, so a refusal is visible as a run that never happened.
function make(options: { target?: BridgeRunTarget | undefined; snippets?: string[]; tabs?: Record<number, BridgeRunTarget> } = {}) {
  const ran: string[] = [];
  const note = (id: string) => () => void ran.push(id);
  const { deps, registry } = make_fake({
    "tab.next": { label: "Next", intent: "x", name: "next", bridge: true, runs_in: "background", run: note("tab.next") },
    "tab.close": { label: "Close", intent: "x", name: "close", runs_in: "background", run: note("tab.close") },
    "scroll.lines": { label: "Scroll", intent: "x", name: "lines", bridge: true, params: [{ name: "count", type: "int", min: 1 }], runs_in: "background", run: note("scroll.lines") },
    "config.reload": { label: "Reload", intent: "x", bridge: true, runs_in: "background", run: note("config.reload") },
    "settings.set": { label: "Set", intent: "x", name: "set", bridge: true, runs_in: "background", run: note("settings.set") },
    "copy.url": { label: "Copy", intent: "x", bridge: true, runs_in: "background", run: note("copy.url") },
    "open.url": { label: "Open", intent: "x", name: "open", bridge: true, params: [{ name: "url", type: "string", main: true, rest: true }], runs_in: "background", run: note("open.url") },
    "snip.hello": { label: "Hello", intent: "x", bridge: true, runs_in: "background", run: note("snip.hello") },
  });
  const calls: Invocation[] = [];
  const run_tabs: number[] = [];
  const router = create_router({ ...deps, show_refusal: async () => undefined });
  const bridge_run = create_bridge_run({
    registry,
    is_snippet: (id) => (options.snippets ?? ["snip.hello"]).includes(id),
    get_enum_sources: deps.get_enum_sources,
    resolve_url,
    target: async (tab_id) => (tab_id === undefined ? ("target" in options ? options.target : NORMAL) : options.tabs?.[tab_id]),
    run: (invocation, target) => (calls.push(invocation), run_tabs.push(target.tab_id), router.run({ invocations: [invocation], mode: "normal", sender_tab_id: target.tab_id, skip_repeat: true })),
  });
  return { bridge_run, ran, calls, run_tabs };
}

test("a command with bridge true runs through the router", async () => {
  const test_case = make();
  assert.deepEqual(await test_case.bridge_run.run("tab.next"), { ok: true });
  assert.deepEqual(await test_case.bridge_run.run("next"), { ok: true });
  assert.deepEqual(test_case.ran, ["tab.next", "tab.next"]);
});

test("a command without the bridge field is refused and does not run", async () => {
  const test_case = make();
  const answer = await test_case.bridge_run.run("tab.close");
  assert.deepEqual(answer, { ok: false, message: "tab.close is not allowed through the bridge" });
  assert.deepEqual(test_case.ran, []);
});

test("the never-list wins over bridge true", async () => {
  const test_case = make();
  for (const text of ["config.reload", "set", "copy.url"]) {
    const answer = await test_case.bridge_run.run(text);
    assert.equal(answer.ok, false, text);
    assert.match((answer as { message: string }).message, /never runs through the bridge/, text);
  }
  assert.deepEqual(test_case.ran, []);
});

test("a snippet never runs, even with bridge true", async () => {
  const test_case = make();
  assert.match(((await test_case.bridge_run.run("snip.hello")) as { message: string }).message, /never runs/);
  assert.deepEqual(test_case.ran, []);
});

test("a bad arg is refused by the one validator before the router", async () => {
  const test_case = make();
  const answer = await test_case.bridge_run.run("scroll.lines 0");
  assert.equal(answer.ok, false);
  assert.deepEqual(test_case.calls, []);
  assert.equal(((await test_case.bridge_run.run("scroll.lines"))).ok, false, "a missing value never opens a command line");
  assert.deepEqual(test_case.ran, []);
  assert.deepEqual(await test_case.bridge_run.run("scroll.lines 3"), { ok: true });
});

test("an unknown command, an empty line, help and a broken quote are refusals", async () => {
  const test_case = make();
  for (const text of ["nothing", "", "   ", "next --help", "scroll.lines 'unclosed"]) assert.equal((await test_case.bridge_run.run(text)).ok, false, JSON.stringify(text));
  assert.deepEqual(test_case.ran, []);
});

test("open.url takes http and https only", async () => {
  const test_case = make();
  const bypasses = ["file:///etc/passwd", "about:config", "MOZ-EXTENSION://abc/x", "ext+x:y", "view-source:https://example.org/", "\u00a0vscode://x", "\ufeffvscode://x", "\u2003steam://run/1", "\u00a0\ufeffabout:blank", "mailto:a@b.c", "\tvscode://x"];
  for (const address of bypasses) {
    const text = `open "${address}"`;
    const answer = await test_case.bridge_run.run(text);
    assert.deepEqual(answer, { ok: false, message: "open.url opens only http and https addresses through the bridge" }, text);
  }
  assert.deepEqual(test_case.ran, []);
  // The handler turns these into a search of the text, so what opens is https and the run passes.
  for (const address of ["vs\tcode://x", "data:text/html,x", "javascript:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", "\u0001javascript:alert(1)", "  javascript:alert(1)", "jav\rascript:alert(1)"]) {
    assert.equal(new URL(await resolve_url(address)).protocol, "https:", address);
    assert.deepEqual(await test_case.bridge_run.run(`open "${address}"`), { ok: true }, address);
  }
  test_case.ran.length = 0;
  assert.deepEqual(await test_case.bridge_run.run("open https://example.org/"), { ok: true });
  assert.deepEqual(await test_case.bridge_run.run("open HTTP://example.org/"), { ok: true });
  // Text the handler reads as a host with a port opens as http or https, so it passes.
  for (const address of ["localhost:8080", "nas:8080", "example.com:8080", "127.0.0.1:8080", "example.org", "some words to search"]) assert.deepEqual(await test_case.bridge_run.run(`open "${address}"`), { ok: true }, address);
  assert.equal(test_case.ran.length, 8);
});

test("a handler refusal comes back as fixed text, never the handler's message", async () => {
  const { deps, registry } = make_fake({
    "tab.next": { label: "Next", intent: "x", bridge: true, runs_in: "background", run: () => { throw new Error('tab 1 exists in several windows: "Bank - statement"'); } },
  });
  const router = create_router({ ...deps, show_refusal: async () => undefined });
  const bridge_run = create_bridge_run({ registry, is_snippet: () => false, get_enum_sources: deps.get_enum_sources,
    resolve_url, target: async () => NORMAL, run: (invocation) => router.run({ invocations: [invocation], mode: "normal", skip_repeat: true }) });
  assert.deepEqual(await bridge_run.run("tab.next"), { ok: false, message: "tab.next failed" });
});

test("the run target is the last focused window only when it is a normal one", async () => {
  const api = (type: string | undefined, incognito = false) => ({
    windows: { getLastFocused: async () => ({ id: 4, type, incognito }) },
    tabs: { query: async () => [{ id: 9, url: "https://example.org/" }] },
  });
  assert.deepEqual(await focused_normal_target(api("normal")), { tab_id: 9, window_id: 4, url: "https://example.org/", incognito: false });
  assert.equal((await focused_normal_target(api("normal", true)))?.incognito, true);
  for (const type of ["popup", "panel", "devtools", "app", undefined]) assert.equal(await focused_normal_target(api(type)), undefined, String(type));
  const none = { windows: { getLastFocused: async () => { throw new Error("no window"); } }, tabs: { query: async () => [] } };
  assert.equal(await focused_normal_target(none), undefined);
});

test("a source word is refused, and the same text in quotes is plain text", async () => {
  const test_case = make();
  for (const text of ["open @clipboard", "open @selection", "open @current_url", "open @bookmark_title", "scroll.lines @clipboard"]) {
    const answer = await test_case.bridge_run.run(text);
    assert.equal(answer.ok, false, text);
  }
  assert.deepEqual(await test_case.bridge_run.run("open @clipboard"), { ok: false, message: "open.url does not take @clipboard or @selection through the bridge" });
  assert.deepEqual(test_case.ran, []);
  assert.deepEqual(await test_case.bridge_run.run("open '@clipboard'"), { ok: true });
  assert.deepEqual(test_case.ran, ["open.url"]);
});

test("the real media command refuses a source word and keeps its plain values", async () => {
  const sources = { search_engines: [], containers: [] };
  const run = async (text: string) => {
    const ran: string[] = [];
    const bridge_run = create_bridge_run({ registry: built_in, is_snippet: () => false, get_enum_sources: async () => sources, resolve_url, target: async () => NORMAL, run: async (invocation) => (ran.push(invocation.id), { ok: true }) });
    return { answer: await bridge_run.run(text), ran };
  };
  for (const text of ["media volume @clipboard", "media @selection", "tab.goto @clipboard"]) {
    const { answer, ran } = await run(text);
    assert.equal(answer.ok, false, text);
    assert.deepEqual(ran, [], text);
  }
  assert.deepEqual((await run("media volume 50")).ran, ["media.act"]);
});

test("an open whose default engine is missing still passes when the url is an address", async () => {
  const no_engine = async (text: string) => url_target(text, "missing", {});
  const { deps, registry } = make_fake({
    "open.url": { label: "Open", intent: "x", name: "open", bridge: true, params: [{ name: "url", type: "string", main: true, rest: true }, { name: "where", type: "enum", values: ["here", "tab"], default: "here" }], runs_in: "background", run: () => undefined },
  });
  const router = create_router({ ...deps, show_refusal: async () => undefined });
  const bridge_run = create_bridge_run({ registry, is_snippet: () => false, get_enum_sources: deps.get_enum_sources, resolve_url: no_engine, target: async () => NORMAL, run: (invocation) => router.run({ invocations: [invocation], mode: "normal", skip_repeat: true }) });
  assert.deepEqual(await bridge_run.run("open --tab https://example.org/"), { ok: true });
  assert.equal((await bridge_run.run("open some words")).ok, false, "text that needs an engine the config lacks is refused");
});

test("a private target refuses a command that opens an address and allows one that does not", async () => {
  const test_case = make({ target: { ...NORMAL, incognito: true } });
  const answer = await test_case.bridge_run.run("open https://example.org/");
  assert.equal(answer.ok, false);
  assert.match((answer as { message: string }).message, /private/);
  assert.deepEqual(await test_case.bridge_run.run("tab.next"), { ok: true });
  assert.deepEqual(test_case.ran, ["tab.next"]);
});

test("with no normal window the run is refused", async () => {
  const test_case = make({ target: undefined });
  assert.deepEqual(await test_case.bridge_run.run("tab.next"), { ok: false, message: "no normal window is open" });
});

test("a failure inside the command comes back as fixed text", async () => {
  const { deps, registry } = make_fake({
    "tab.next": { label: "Next", intent: "x", bridge: true, runs_in: "background", run: () => { throw new Error("no next tab"); } },
  });
  const router = create_router({ ...deps, show_refusal: async () => undefined });
  const bridge_run = create_bridge_run({
    registry,
    is_snippet: () => false,
    get_enum_sources: deps.get_enum_sources,
    resolve_url,
    target: async () => NORMAL,
    run: (invocation) => router.run({ invocations: [invocation], mode: "normal", skip_repeat: true }),
  });
  assert.deepEqual(await bridge_run.run("tab.next"), { ok: false, message: "tab.next failed" });
});

test("list offers only the commands the bridge allows, with their params", () => {
  const test_case = make();
  const listed = test_case.bridge_run.list().map((meta) => meta.id).sort();
  assert.deepEqual(listed, ["open.url", "scroll.lines", "tab.next"]);
  assert.deepEqual(test_case.bridge_run.list().find((meta) => meta.id === "scroll.lines")?.params?.[0]?.name, "count");
});

// The audit of the real registry.

test("every built-in command states the bridge field", () => {
  const missing = built_in.list().filter((command) => typeof command.bridge !== "boolean").map((command) => command.id);
  assert.deepEqual(missing, []);
});

test("a never-listed built-in command does not say yes", () => {
  const wrong = built_in.list().filter((command) => never_listed(command.id) && command.bridge === true).map((command) => command.id);
  assert.deepEqual(wrong, []);
});

test("the never-list and the open-address list name real commands", () => {
  const ids = new Set(built_in.list().map((command) => command.id));
  const page_ids = ["page.reload", "page.save_pdf", "hint.run", "hint.key", "visual.act", "open.clipboard", "command.repeat", "macro.play"];
  for (const id of page_ids) assert.ok(ids.has(id), id);
  for (const group of ["config", "settings", "session", "copy", "register", "debug", "native", "permissions"]) assert.ok([...ids].some((id) => id.startsWith(`${group}.`)), group);
  const opens = [...ids].filter(opens_url);
  assert.ok(opens.includes("open.url") && opens.includes("tab.load") && opens.includes("window.new"));
});

test("the built-in commands that open an address and say yes are pinned", () => {
  // Not a rule: a new address-opening command that says yes is a visible edit here.
  const yes = built_in.list().filter((command) => command.bridge === true).map((command) => command.id);
  assert.deepEqual(yes.filter(opens_url), ["open.url"]);
});

test("tab.switch and tab.close say no, because the id-addressed tab verbs behind bridge_share_tabs replace them", () => {
  // tab.switch matches a title or address, so a caller could probe which tabs exist from the answer. tab.close closes whole sides of the tab bar and needs no opt-in.
  assert.equal(built_in.get("tab.switch")?.bridge, false);
  assert.equal(built_in.get("tab.close")?.bridge, false);
});

// `--tab`: the same rules as a run in the focused window, then the named tab.

const THIRD: BridgeRunTarget = { tab_id: 42, window_id: 2, url: "https://example.net/", incognito: false };

test("a run with a tab id runs in that tab and not in the focused one", async () => {
  const test_case = make({ tabs: { 42: THIRD } });
  assert.deepEqual(await test_case.bridge_run.run("tab.next", 42), { ok: true });
  assert.deepEqual(await test_case.bridge_run.run("tab.next"), { ok: true });
  assert.deepEqual(test_case.run_tabs, [42, 7]);
});

test("a tab id that is stale, private or not a normal tab is refused with the same text, and nothing runs", async () => {
  // The target lookup answers undefined for a private tab, a popup tab and a missing one alike.
  const test_case = make({ tabs: { 42: THIRD } });
  for (const tab_id of [5, 43, -1]) assert.deepEqual(await test_case.bridge_run.run("tab.next", tab_id), { ok: false, message: "no such tab" });
  assert.deepEqual(test_case.ran, []);
});

test("every refusal of a plain run holds with a tab id, with the same text, and the tab is not looked up for a refused command", async () => {
  const test_case = make({ tabs: { 42: THIRD } });
  const texts = ["tab.close", "config.reload", "set", "copy.url", "snip.hello", "nothing", "", "next --help", "scroll.lines 0", "scroll.lines", "open @clipboard", "open @selection", "open \"vscode://x\"", "open \"file:///etc/passwd\""];
  for (const text of texts) assert.deepEqual(await test_case.bridge_run.run(text, 42), await test_case.bridge_run.run(text), JSON.stringify(text));
  assert.deepEqual(test_case.ran, []);
  assert.deepEqual(test_case.run_tabs, []);
});

test("a tab id keeps the address rules: an http address opens in the named tab, and a private window is not a tab target", async () => {
  const test_case = make({ tabs: { 42: THIRD } });
  assert.deepEqual(await test_case.bridge_run.run("open https://example.org/", 42), { ok: true });
  assert.deepEqual(test_case.run_tabs, [42]);
  const private_case = make({ target: { ...NORMAL, incognito: true }, tabs: {} });
  assert.deepEqual(await private_case.bridge_run.run("open https://example.org/", 99), { ok: false, message: "no such tab" });
});

test("a handler failure in a named tab comes back as fixed text", async () => {
  const { deps, registry } = make_fake({
    "tab.next": { label: "Next", intent: "x", bridge: true, runs_in: "background", run: () => { throw new Error('"Bank - statement" is gone'); } },
  });
  const router = create_router({ ...deps, show_refusal: async () => undefined });
  const bridge_run = create_bridge_run({ registry, is_snippet: () => false, get_enum_sources: deps.get_enum_sources, resolve_url, target: async () => THIRD, run: (invocation, target) => router.run({ invocations: [invocation], mode: "normal", sender_tab_id: target.tab_id, skip_repeat: true }) });
  assert.deepEqual(await bridge_run.run("tab.next", 42), { ok: false, message: "tab.next failed" });
});
