import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { create_omnibox, MAX_SUGGESTIONS } from "../../src/background/omnibox.ts";
import { create_completer } from "../../src/cmdline/completion/sources.ts";
import type { Completion, Row } from "../../src/cmdline/completion/sources.ts";
import { create_router } from "../../src/background/router.ts";
import { create_word_lookup } from "../../src/cmdline/word_lookup.ts";
import { command_meta } from "../../src/shared/registry/index.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { make_fake } from "./fakes.ts";

const WHERE = ["here", "tab", "background"] as const;

type Completer = Parameters<typeof create_omnibox>[0]["completer"];

function make(options: { disabled?: boolean; incognito?: boolean; completer?: Completer } = {}) {
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
    completer:
      options.completer ??
      (async () => {
        const commands = registry.list().map(command_meta);
        const aliases = { nx: "tab.next", qzv: "tab.next" };
        return { complete: create_completer(create_word_lookup(commands, aliases), commands, aliases, { search_engines: [], containers: [] }), keys: new Map([["tab.next", "<A-l>"]]) };
      }),
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

const row = (name: string, insert: string, description = "", id?: string): Completion["rows"][number] => ({ name, insert, description, args: "", also_named: [], keywords: [], usage: "", positions: [], ...(id === undefined ? {} : { id }) }) as Row & { positions: number[] };
const completion = (rows: Completion["rows"], start = 0): Completion => ({ rows, start, end: start, listing: true });

test("suggestions come from the completer: full command text as content, summary and keys as description", async () => {
  const t = make();
  let shown: { content: string; description: string }[] = [];
  await t.omnibox.changed("tab.ne", (results) => (shown = results));
  const next = shown.find((result) => result.content === "next");
  assert.ok(next, JSON.stringify(shown));
  assert.match(next.description, /^next {2}.*<A-l>$/);
});

test("a configured alias is suggested", async () => {
  const t = make();
  let shown: { content: string; description: string }[] = [];
  await t.omnibox.changed("qzv", (results) => (shown = results));
  assert.ok(shown.some((result) => result.content === "next"), JSON.stringify(shown));
});

test("the content keeps the typed words before the one that completes", async () => {
  const t = make({ completer: async () => ({ complete: () => completion([row("--tab", "--tab ")], 5), keys: new Map() }) });
  let shown: { content: string; description: string }[] = [];
  await t.omnibox.changed("open --t", (results) => (shown = results));
  assert.equal(shown[0]?.content, "open --tab ");
});

test("suggestions are capped", async () => {
  const many = Array.from({ length: MAX_SUGGESTIONS + 15 }, (_, index) => row(`c${index}`, `c${index} `));
  const t = make({ completer: async () => ({ complete: () => completion(many), keys: new Map() }) });
  let shown: unknown[] = [];
  await t.omnibox.changed("", (results) => (shown = results));
  assert.equal(shown.length, MAX_SUGGESTIONS);
});

test("the description is plain text: config text is shown as written, with no markup added", async () => {
  const t = make({ completer: async () => ({ complete: () => completion([row("<b>x</b>", "x ", "a & b", "snip.x")]), keys: new Map([["snip.x", "<C-&>"]]) }) });
  let shown: { content: string; description: string }[] = [];
  await t.omnibox.changed("x", (results) => (shown = results));
  assert.equal(shown[0]?.description, "<b>x</b>  a & b  <C-&>");
});

test("a stale answer is dropped", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  const t = make({
    completer: async () => {
      if (calls++ === 0) await gate;
      return { complete: (text) => completion([row(`answer-${text}`, `${text} `)]), keys: new Map() };
    },
  });
  const seen: string[] = [];
  const first = t.omnibox.changed("a", (results) => seen.push(...results.map((result) => result.content)));
  await t.omnibox.changed("ab", (results) => seen.push(...results.map((result) => result.content)));
  release();
  await first;
  assert.deepEqual(seen, ["ab "]);
});

test("no history, tab or bookmark rows appear, in a private window or not", async () => {
  for (const incognito of [false, true]) {
    const t = make({ incognito });
    let shown: unknown[] = ["unset"];
    await t.omnibox.changed("open ", (results) => (shown = results));
    assert.deepEqual(shown, [], `incognito ${incognito}`);
  }
});
