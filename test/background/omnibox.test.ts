import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { create_omnibox } from "../../src/background/omnibox.ts";
import { create_router } from "../../src/background/router.ts";
import { create_word_lookup } from "../../src/cmdline/word_lookup.ts";
import { command_meta } from "../../src/shared/registry/index.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { make_fake } from "./fakes.ts";

const WHERE = ["here", "tab", "background"] as const;

function make(options: { disabled?: boolean; incognito?: boolean } = {}) {
  const ran: string[] = [];
  const history: string[] = [];
  const { deps, registry, log } = make_fake(
    {
      "tab.next": { label: "Next", intent: "x", name: "next", runs_in: "background", run: () => void ran.push("tab.next") },
      "tab.goto": { label: "Goto", intent: "x", name: "goto", params: [{ name: "index", type: "int", min: 1 }], runs_in: "background", run: (_context, args) => void ran.push(`tab.goto ${String(args.index)}`) },
      "open.url": {
        label: "Open", intent: "x", name: "open", runs_in: "background",
        params: [{ name: "url", type: "string", main: true, rest: true }, { name: "where", type: "enum", values: WHERE, optional: true }],
        run: (_context, args) => void ran.push(`open ${String(args.url)} ${String(args.where ?? "")}`),
      },
      "scroll.lines": { label: "Scroll", intent: "x", name: "scroll", runs_in: "content" },
    },
    {
      is_disabled: async () => options.disabled === true,
      active_tab: async () => ({ tab_id: 7, window_id: 1, url: "about:support", incognito: options.incognito === true }),
      // A protected page has no content script, so a toast cannot arrive.
      has_content_script: async () => false,
      send_to_tab: async () => {
        throw new Error("no receiver");
      },
    },
  );
  const router = create_router(deps);
  const omnibox = create_omnibox({
    registry,
    lookup: async () => create_word_lookup(registry.list().map(command_meta), { nx: "tab.next" }),
    get_enum_sources: deps.get_enum_sources,
    active_tab: deps.active_tab,
    mode_of: async () => "normal",
    run: router.run,
    show_refusal: deps.show_refusal,
    record_history: async (text, from_private_window) => void (from_private_window || history.push(text)),
  });
  return { omnibox, ran, history, log, registry, deps };
}

test("entered text runs the command through the router", async () => {
  const t = make();
  await t.omnibox.entered("  tab.next ", "currentTab");
  assert.deepEqual(t.ran, ["tab.next"]);
});

test("a bad argument is refused by the one validator, with its text, and nothing runs", async () => {
  const t = make();
  await t.omnibox.entered("goto 0", "currentTab");
  const direct = check_args(t.registry.get("tab.goto")!, { index: "0" }, await t.deps.get_enum_sources());
  assert.equal(direct.ok, false);
  assert.deepEqual(t.ran, []);
  assert.deepEqual(t.log, [`refuse 7 ${(direct as { error: string }).error}`]);
});

test("a command that needs a value refuses instead of prompting", async () => {
  const t = make();
  await t.omnibox.entered("goto", "currentTab");
  assert.deepEqual(t.ran, []);
  assert.equal(t.log.length, 1);
  assert.match(t.log[0]!, /^refuse 7 /);
  assert.ok(!t.log.some((line) => line.startsWith("cmdline")));
});

test("plain text and an empty line are refused", async () => {
  const t = make();
  await t.omnibox.entered("rust borrow checker", "currentTab");
  await t.omnibox.entered("   ", "currentTab");
  assert.deepEqual(t.ran, []);
  assert.match(t.log[0]!, /unknown command "rust"/);
  assert.match(t.log[1]!, /Type a DesertFox command/);
});

test("a modified Enter sets where on a command that has it, and leaves others alone", async () => {
  const t = make();
  await t.omnibox.entered("open https://a.example", "currentTab");
  await t.omnibox.entered("open https://b.example", "newForegroundTab");
  await t.omnibox.entered("open https://c.example", "newBackgroundTab");
  await t.omnibox.entered("next", "newForegroundTab");
  assert.deepEqual(t.ran, ["open https://a.example ", "open https://b.example tab", "open https://c.example background", "tab.next"]);
});

test("DesertFox off shows the off refusal and records nothing", async () => {
  const t = make({ disabled: true });
  await t.omnibox.entered("next", "currentTab");
  assert.deepEqual(t.ran, []);
  assert.deepEqual(t.log, ["refuse 7 DesertFox is off"]);
  assert.deepEqual(t.history, []);
});

test("a configured alias runs like its command", async () => {
  const t = make();
  await t.omnibox.entered("nx", "currentTab");
  assert.deepEqual(t.ran, ["tab.next"]);
});

test("a content command refuses on a page with no content script, and the refusal is delivered", async () => {
  const t = make();
  await t.omnibox.entered("scroll", "currentTab");
  assert.deepEqual(t.ran, []);
  assert.equal(t.log.filter((line) => line.startsWith("refuse 7")).length, 1);
});

test("a parsed command is recorded in the history, a private window's is not, a parse failure is not", async () => {
  const t = make();
  await t.omnibox.entered("next", "currentTab");
  await t.omnibox.entered("nonsense", "currentTab");
  assert.deepEqual(t.history, ["next"]);
  const p = make({ incognito: true });
  await p.omnibox.entered("next", "currentTab");
  assert.deepEqual(p.history, []);
});
