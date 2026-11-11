import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { create_bridge_run, never_listed, opens_url, type BridgeRunTarget } from "../../src/background/bridge_run.ts";
import { create_router } from "../../src/background/router.ts";
import { registry as built_in } from "../../src/shared/registry/builtin.ts";
import type { Invocation } from "../../src/shared/invocation.ts";
import { make_fake } from "./fakes.ts";

const NORMAL: BridgeRunTarget = { tab_id: 7, window_id: 1, url: "https://example.org/", incognito: false };

// A registry of fake commands that count their runs, so a refusal is visible as a run that never happened.
function make(options: { target?: BridgeRunTarget | undefined; snippets?: string[] } = {}) {
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
  const router = create_router({ ...deps, show_refusal: async () => undefined });
  const bridge_run = create_bridge_run({
    registry,
    is_snippet: (id) => (options.snippets ?? ["snip.hello"]).includes(id),
    get_enum_sources: deps.get_enum_sources,
    target: async () => ("target" in options ? options.target : NORMAL),
    run: (invocation, target) => (calls.push(invocation), router.run({ invocations: [invocation], mode: "normal", sender_tab_id: target.tab_id, skip_repeat: true })),
  });
  return { bridge_run, ran, calls };
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
  for (const text of ["open file:///etc/passwd", "open javascript:alert(1)", "open about:config", "open data:text/html,x", "open MOZ-EXTENSION://abc/x", "open ext+x:y"]) {
    const answer = await test_case.bridge_run.run(text);
    assert.deepEqual(answer, { ok: false, message: "open.url opens only http and https addresses through the bridge" }, text);
  }
  assert.deepEqual(test_case.ran, []);
  assert.deepEqual(await test_case.bridge_run.run("open https://example.org/"), { ok: true });
  assert.deepEqual(await test_case.bridge_run.run("open HTTP://example.org/"), { ok: true });
  assert.deepEqual(test_case.ran, ["open.url", "open.url"]);
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

test("a failure inside the command comes back as the refusal text", async () => {
  const { deps, registry } = make_fake({
    "tab.next": { label: "Next", intent: "x", bridge: true, runs_in: "background", run: () => { throw new Error("no next tab"); } },
  });
  const router = create_router({ ...deps, show_refusal: async () => undefined });
  const bridge_run = create_bridge_run({
    registry,
    is_snippet: () => false,
    get_enum_sources: deps.get_enum_sources,
    target: async () => NORMAL,
    run: (invocation) => router.run({ invocations: [invocation], mode: "normal", skip_repeat: true }),
  });
  assert.deepEqual(await bridge_run.run("tab.next"), { ok: false, message: "no next tab" });
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
  const page_ids = ["page.reload", "page.save_pdf", "hint.run", "hint.key"];
  for (const id of page_ids) assert.ok(ids.has(id), id);
  for (const group of ["config", "settings", "session", "copy", "register", "debug", "native", "permissions"]) assert.ok([...ids].some((id) => id.startsWith(`${group}.`)), group);
  const opens = [...ids].filter(opens_url);
  assert.ok(opens.includes("open.url") && opens.includes("tab.load") && opens.includes("window.new"));
});

test("a built-in command that opens an address and says yes is a command to look at twice", () => {
  // Not a rule: it pins today's choice, so flipping `open.url` to yes is a visible edit in this test.
  const yes = built_in.list().filter((command) => command.bridge === true).map((command) => command.id);
  assert.deepEqual(yes.filter(opens_url), []);
});
