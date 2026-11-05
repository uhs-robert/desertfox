import assert from "node:assert/strict";
import { test } from "node:test";
import { create_router } from "../../src/background/router.ts";
import { make_fake } from "./fakes.ts";

test("a background command runs with checked args and the count rule", async () => {
  const seen: unknown[] = [];
  const { deps } = make_fake({
    "tab.close": {
      label: "Close Tab",
      intent: "x",
      params: [{ name: "focus", type: "enum", values: ["right", "left"], default: "right" }],
      runs_in: "background",
      count: "repeat",
      run: (ctx, args) => void seen.push([ctx.tab_id, args]),
    },
  });
  const response = await create_router(deps).run({ invocations: [{ id: "tab.close", count: 2 }], mode: "normal" });
  assert.deepEqual(response, { ok: true });
  assert.deepEqual(seen, [[7, { focus: "right" }], [7, { focus: "right" }]]);
});

test("context sources are filled", async () => {
  const seen: unknown[] = [];
  const { deps } = make_fake({
    "open.go": {
      label: "Go",
      intent: "x",
      params: [
        { name: "query", type: "string", default: { from: "selection" } },
        { name: "page", type: "string", default: { from: "current_url" } },
      ],
      runs_in: "background",
      run: (_ctx, args) => void seen.push(args),
    },
  });
  await create_router(deps).run({ invocations: [{ id: "open.go" }], mode: "normal" });
  assert.deepEqual(seen, [{ query: "chosen text", page: "https://example.org/" }]);
});

test("an empty selection in a default opens the command line with the param left open", async () => {
  const { deps, log } = make_fake(
    { "open.go": { label: "Go", intent: "x", name: "go", params: [{ name: "q", type: "string", main: true, default: { from: "selection" } }], runs_in: "background", run: () => assert.fail() } },
    { ask_selection: async () => "" },
  );
  const response = await create_router(deps).run({ invocations: [{ id: "open.go" }], mode: "normal", may_prompt: true });
  assert.deepEqual(response, { ok: true });
  assert.deepEqual(log, ["cmdline 7 0 go "]);
});

test("a prefilled query that starts with an engine name keeps its -- guard", async () => {
  const commands = {
    "open.find": {
      label: "Find",
      intent: "x",
      name: "find",
      params: [
        { name: "engine", type: "enum", values: { from: "search_engines" }, default: "" },
        { name: "query", type: "string", main: true, default: { from: "selection" } },
      ],
      runs_in: "background",
      run: () => assert.fail(),
    },
  } as const;
  const { deps, log } = make_fake(commands, { ask_selection: async () => "arch linux" });
  const binding = { id: "open.find", prompt: { param: "query", prefill: { from: "selection" } as const } };
  await create_router(deps).run({ invocations: [binding], mode: "normal", may_prompt: true });
  assert.deepEqual(log, ["cmdline 7 0 find -- arch linux"]);
});

test("an empty selection in an explicit @selection arg opens the line, a full one runs", async () => {
  const seen: unknown[] = [];
  const commands = { "site.find": { label: "Find", intent: "x", name: "find", params: [{ name: "query", type: "string", rest: true, main: true }, { name: "where", type: "string", default: "here" }], runs_in: "background", run: (_ctx: unknown, args: unknown) => void seen.push(args) } } as const;
  const empty = make_fake(commands, { ask_selection: async () => "" });
  const key = { id: "site.find", args: { query: { from: "selection" }, where: "tab" } };
  assert.deepEqual(await create_router(empty.deps).run({ invocations: [key], mode: "normal", may_prompt: true }), { ok: true });
  assert.deepEqual(empty.log, ["cmdline 7 0 find --where=tab "]);
  const full = make_fake(commands);
  await create_router(full.deps).run({ invocations: [key], mode: "normal", may_prompt: true });
  assert.deepEqual(seen, [{ query: "chosen text", where: "tab" }]);
  assert.deepEqual(full.log, []);
});

test("a missing required param without a prompt is refused, an explicit prompt opens the command line", async () => {
  const { deps, log } = make_fake({
    "open.url": { label: "Open", intent: "x", name: "open", params: [{ name: "url", type: "string" }], runs_in: "background", run: () => assert.fail() },
  });
  const refused = await create_router(deps).run({ invocations: [{ id: "open.url" }], mode: "normal", may_prompt: true });
  assert.equal(refused.ok, false);
  assert.match(log[0]!, /^refuse 7 .*url/);
  assert.equal(log.length, 1);
  assert.deepEqual(await create_router(deps).run({ invocations: [{ id: "open.url", prompt: { param: "url" } }], mode: "normal", may_prompt: true }), { ok: true });
  assert.deepEqual(log.slice(1), ["cmdline 7 0 open --url="]);
});

test("a prompt opens the line with the prefill resolved now, and runs nothing", async () => {
  const { deps, log } = make_fake({
    "open.url": { label: "Open", intent: "x", name: "open", params: [{ name: "url", type: "string" }, { name: "where", type: "string", default: "here" }], runs_in: "background", run: () => assert.fail() },
  });
  const binding = { id: "open.url", args: { where: "tab" }, prompt: { param: "url", prefill: { from: "current_url" } as const } };
  await create_router(deps).run({ invocations: [binding], mode: "normal", may_prompt: true });
  const bare = { id: "open.url", prompt: { param: "url" } };
  await create_router(deps).run({ invocations: [bare], mode: "normal", may_prompt: true });
  assert.deepEqual(log, ["cmdline 7 0 open --url=https://example.org/ --where=tab", "cmdline 7 0 open --url="]);
});

test("a prompt with an empty selection prefills empty, and a count is dropped", async () => {
  const { deps, log } = make_fake(
    { "open.go": { label: "Go", intent: "x", name: "go", params: [{ name: "q", type: "string", main: true }], runs_in: "background", count: "repeat", run: () => assert.fail() } },
    { ask_selection: async () => "" },
  );
  await create_router(deps).run({ invocations: [{ id: "open.go", count: 3, prompt: { param: "q", prefill: { from: "selection" } } }], mode: "normal", may_prompt: true });
  assert.deepEqual(log, ["cmdline 7 0 go "]);
});

test("opening the line on a tab with no content script refuses", async () => {
  const { deps, log } = make_fake(
    { "open.url": { label: "Open", intent: "x", name: "open", params: [{ name: "url", type: "string" }], runs_in: "background", run: () => assert.fail() } },
    { has_content_script: async () => false, open_cmdline: async () => { throw new Error("no receiver"); } },
  );
  const response = await create_router(deps).run({ invocations: [{ id: "open.url", prompt: { param: "url" } }], mode: "normal", may_prompt: true });
  assert.equal(response.ok, false);
  assert.deepEqual(log, ["refuse 7 Open needs a page OasisFox runs on"]);
});

test("a bad arg, an unknown id and an unmet need refuse", async () => {
  const { deps, log } = make_fake(
    {
      "a.b": { label: "AB", intent: "x", params: [{ name: "n", type: "int", default: 1 }], runs_in: "background", needs: ["content"], run: () => {} },
    },
    { has_content_script: async (id) => id !== 7 },
  );
  const router = create_router(deps);
  await router.run({ invocations: [{ id: "a.b" }], mode: "normal", may_prompt: true });
  await router.run({ invocations: [{ id: "nope.nope" }], mode: "normal", may_prompt: true });
  assert.match(log[0]!, /needs a page OasisFox runs on/);
  assert.match(log[1]!, /unknown command/);
});

test("a content command goes to the tab with count repeated", async () => {
  const { deps, log } = make_fake({
    "scroll.lines": {
      label: "Scroll",
      intent: "x",
      params: [{ name: "lines", type: "int", default: 1 }],
      runs_in: "content",
      count: "repeat",
      run: () => assert.fail(),
    },
  });
  await create_router(deps).run({ invocations: [{ id: "scroll.lines", count: 2 }], mode: "normal", may_prompt: true });
  const one = { id: "scroll.lines", args: { lines: 1 } };
  assert.deepEqual(log, [`send 7 ${JSON.stringify({ type: "run_in_content", invocations: [one, one] })}`]);
});

test("a content command into a tab without a script refuses and stops the chain", async () => {
  const { deps, log } = make_fake(
    {
      "scroll.lines": { label: "Scroll", intent: "x", runs_in: "content", run: () => {} },
      "a.b": { label: "AB", intent: "x", runs_in: "background", run: () => assert.fail() },
    },
    { send_to_tab: async () => Promise.reject(new Error("no receiver")) },
  );
  const response = await create_router(deps).run({ invocations: [{ id: "scroll.lines" }, { id: "a.b" }], mode: "normal", may_prompt: true });
  assert.equal(response.ok, false);
  assert.equal(log.length, 1);
});

test("a throwing handler refuses with its message", async () => {
  const { deps, log } = make_fake({
    "a.b": { label: "AB", intent: "x", runs_in: "background", run: () => { throw new Error("boom"); } },
  });
  await create_router(deps).run({ invocations: [{ id: "a.b" }], mode: "normal", may_prompt: true });
  assert.deepEqual(log, ["refuse 7 boom"]);
});

test("the active tab is read again for each repeat and each invocation", async () => {
  let active = 1;
  const seen: number[] = [];
  const { deps } = make_fake(
    {
      "tab.next": { label: "Next", intent: "x", runs_in: "background", count: "repeat", run: (ctx) => void (seen.push(ctx.tab_id!), active++) },
    },
    { active_tab: async () => ({ tab_id: active, window_id: 1, url: undefined }) },
  );
  await create_router(deps).run({ invocations: [{ id: "tab.next", count: 2 }, { id: "tab.next" }], mode: "normal", may_prompt: true });
  assert.deepEqual(seen, [1, 2, 3]);
});

test("content runs and the command line open go to the sender frame, or frame 0", async () => {
  const frames: (number | undefined)[] = [];
  const { deps } = make_fake(
    {
      "scroll.lines": { label: "Scroll", intent: "x", runs_in: "content", run: () => {} },
      "open.url": { label: "Open", intent: "x", params: [{ name: "url", type: "string" }], runs_in: "background", run: () => {} },
    },
    {
      send_to_tab: async (_tab, _message, frame_id) => void frames.push(frame_id),
      show_refusal: async (_tab, _refusal, frame_id) => void frames.push(frame_id),
      open_cmdline: async (_tab, frame_id) => void frames.push(frame_id),
    },
  );
  const router = create_router(deps);
  await router.run({ invocations: [{ id: "scroll.lines" }, { id: "open.url" }], mode: "normal", sender_tab_id: 7, frame_id: 3 });
  await router.run({ invocations: [{ id: "scroll.lines" }], mode: "normal", may_prompt: true });
  assert.deepEqual(frames, [3, 3, 0]);
});

test("a prompt binding opens the line even when no param is missing", async () => {
  const { deps, log } = make_fake({
    "bookmark.add": {
      label: "Add Bookmark",
      intent: "x",
      params: [{ name: "url", type: "string", default: { from: "current_url" } }],
      runs_in: "background",
      run: () => assert.fail(),
    },
  });
  const response = await create_router(deps).run({
    invocations: [{ id: "bookmark.add", prompt: { param: "url", prefill: { from: "current_url" } } }],
    mode: "normal",
    may_prompt: true,
  });
  assert.deepEqual(response, { ok: true });
  assert.deepEqual(log, ["cmdline 7 0 bookmark.add --url=https://example.org/"]);
});

test("get_selection goes to the sender frame", async () => {
  const asked: [number, number][] = [];
  const { deps } = make_fake(
    { "open.go": { label: "Go", intent: "x", params: [{ name: "q", type: "string", default: { from: "selection" } }], runs_in: "background", run: () => {} } },
    { ask_selection: async (tab_id, frame_id) => (asked.push([tab_id, frame_id]), "text") },
  );
  await create_router(deps).run({ invocations: [{ id: "open.go" }], mode: "normal", sender_tab_id: 7, frame_id: 3 });
  assert.deepEqual(asked, [[7, 3]]);
});

test("a sender frame is not used in a different tab", async () => {
  const frames: (number | undefined)[] = [];
  const { deps } = make_fake(
    { "scroll.lines": { label: "Scroll", intent: "x", runs_in: "content", run: () => {} } },
    { send_to_tab: async (_tab, _message, frame_id) => void frames.push(frame_id) },
  );
  await create_router(deps).run({ invocations: [{ id: "scroll.lines" }], mode: "normal", sender_tab_id: 99, frame_id: 3 });
  assert.deepEqual(frames, [0]);
});

const open_url = { label: "Open", intent: "x", name: "open", params: [{ name: "url", type: "string" as const, main: true }], runs_in: "background" as const, run: () => assert.fail() };

// A line the test finishes by hand: the reply of `open_cmdline` stays pending until `reply` is called.
function pending_line() {
  const replies: ((reply: unknown) => void)[] = [];
  return { open_cmdline: () => new Promise<unknown>((resolve) => replies.push(resolve)), reply: (value: unknown) => replies[0]!(value) };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));

test("a prompt waits for the line, and the next step runs after the user submits", async () => {
  const closed: string[] = [];
  const line = pending_line();
  const { deps, log } = make_fake({ "open.url": open_url, "tab.close": { label: "Close", intent: "x", runs_in: "background", run: () => void closed.push("closed") } }, { open_cmdline: line.open_cmdline });
  const running = create_router(deps).run({ invocations: [{ id: "open.url", prompt: { param: "url" } }, { id: "tab.close" }], mode: "normal", may_prompt: true });
  await turn();
  assert.deepEqual(closed, []);
  line.reply({ ok: true });
  assert.deepEqual(await running, { ok: true });
  assert.deepEqual(closed, ["closed"]);
  assert.deepEqual(log, []);
});

test("a cancelled line stops the sequence with no toast and stores nothing", async () => {
  const closed: string[] = [];
  const line = pending_line();
  const { deps, log, slots } = make_fake({ "open.url": open_url, "tab.close": { label: "Close", intent: "x", runs_in: "background", run: () => void closed.push("closed") } }, { open_cmdline: line.open_cmdline });
  const running = create_router(deps).run({ invocations: [{ id: "tab.close" }, { id: "open.url", prompt: { param: "url" } }, { id: "tab.close" }], mode: "normal", may_prompt: true });
  await turn();
  line.reply({ ok: true, cancelled: true });
  assert.deepEqual(await running, { ok: true, cancelled: true });
  assert.deepEqual(closed, ["closed"]);
  assert.deepEqual(log, []);
  assert.equal(slots.normal, undefined);
});

test("a line that fails to open stops the sequence with one toast", async () => {
  const closed: string[] = [];
  const { deps, log } = make_fake(
    { "open.url": open_url, "tab.close": { label: "Close", intent: "x", runs_in: "background", run: () => void closed.push("closed") } },
    { open_cmdline: async () => ({ ok: false, message: "The command line is already open" }) },
  );
  const response = await create_router(deps).run({ invocations: [{ id: "open.url", prompt: { param: "url" } }, { id: "tab.close" }], mode: "normal", may_prompt: true });
  assert.equal(response.ok, false);
  assert.deepEqual(closed, []);
  assert.deepEqual(log, ["refuse 7 The command line is already open"]);
});

test("a content step waits for its answer: done goes on, failed stops with one toast, cancelled stops quietly, no answer is done", async () => {
  const commands = {
    "page.look": { label: "Look", intent: "x", runs_in: "content" as const, run: () => {} },
    "tab.close": { label: "Close", intent: "x", runs_in: "background" as const, run: () => void ran.push("closed") },
  };
  const ran: string[] = [];
  const cases: [unknown, boolean, string[]][] = [
    [{ ok: true }, true, ["closed"]],
    [undefined, true, ["closed"]],
    [{ ok: true, cancelled: true }, true, []],
    [{ ok: false, message: "No hints on this page" }, false, []],
  ];
  for (const [answer, ok, expected] of cases) {
    ran.length = 0;
    const { deps, log } = make_fake(commands, { send_to_tab: async () => answer });
    const response = await create_router(deps).run({ invocations: [{ id: "page.look" }, { id: "tab.close" }], mode: "normal" });
    assert.equal(response.ok, ok);
    assert.deepEqual(ran, expected);
    assert.deepEqual(log, ok ? [] : ["refuse 7 No hints on this page"]);
  }
});

test("a content step whose reply is lost refuses with the page message and stops", async () => {
  const ran: string[] = [];
  const { deps, log } = make_fake(
    {
      "page.look": { label: "Look", intent: "x", runs_in: "content", run: () => {} },
      "tab.close": { label: "Close", intent: "x", runs_in: "background", run: () => void ran.push("closed") },
    },
    { send_to_tab: async () => { throw new Error("The message channel closed"); } },
  );
  const response = await create_router(deps).run({ invocations: [{ id: "page.look" }, { id: "tab.close" }], mode: "normal" });
  assert.equal(response.ok, false);
  assert.deepEqual(ran, []);
  assert.deepEqual(log, ["refuse 7 Look needs a page OasisFox runs on"]);
});

test("a prompt that was filled in stores nothing, because the line stores the command it runs", async () => {
  const { deps, slots } = make_fake({ "open.url": open_url, "tab.echo": { label: "Echo", intent: "x", runs_in: "background", run: () => {} } });
  await create_router(deps).run({ invocations: [{ id: "tab.echo" }, { id: "open.url", prompt: { param: "url" } }], mode: "normal", may_prompt: true });
  assert.equal(slots.normal, undefined);
});

test("without may_prompt a missing arg or a prompt gets the validation failure", async () => {
  const { deps, log } = make_fake({
    "open.url": { label: "Open", intent: "x", name: "open", params: [{ name: "url", type: "string", main: true }], runs_in: "background", run: () => assert.fail() },
  });
  const router = create_router(deps);
  const missing = await router.run({ invocations: [{ id: "open.url" }], mode: "normal" });
  assert.deepEqual(missing.ok === false && missing.refusal.message, "missing <url>");
  const prompted = await router.run({ invocations: [{ id: "open.url", prompt: { param: "url" } }], mode: "normal" });
  assert.equal(prompted.ok, false);
  assert.ok(log.every((entry) => entry.startsWith("refuse")), log.join());
});

test("a prompt binding with a bad fixed arg refuses instead of opening the line", async () => {
  const { deps, log } = make_fake({
    "open.url": {
      label: "Open",
      intent: "x",
      name: "open",
      params: [{ name: "url", type: "string", main: true }, { name: "where", type: "enum", values: ["here", "tab"], default: "here" }],
      runs_in: "background",
      run: () => assert.fail(),
    },
  });
  const response = await create_router(deps).run({
    invocations: [{ id: "open.url", args: { where: "bogus" }, prompt: { param: "url" } }],
    mode: "normal",
    may_prompt: true,
  });
  assert.equal(response.ok, false);
  assert.match(log[0]!, /^refuse 7 where expects/);
});

test("a reply lost after the line opened on a live page is cancelled, as when Enter navigates this tab", async () => {
  const ran: string[] = [];
  const { deps, log } = make_fake(
    { "open.url": open_url, "tab.close": { label: "Close", intent: "x", runs_in: "background", run: () => void ran.push("closed") } },
    { open_cmdline: async () => { throw new Error("The message channel closed"); } },
  );
  const response = await create_router(deps).run({ invocations: [{ id: "open.url", prompt: { param: "url" } }, { id: "tab.close" }], mode: "normal", may_prompt: true });
  assert.deepEqual(response, { ok: true, cancelled: true });
  assert.deepEqual(ran, []);
  assert.deepEqual(log, []);
});

test("a background command that returns a failed outcome stops the sequence with one toast", async () => {
  const ran: string[] = [];
  const { deps, log } = make_fake({
    "tab.fail": { label: "Fail", intent: "x", runs_in: "background", run: () => ({ ok: false, message: "nothing to do" }) },
    "tab.close": { label: "Close", intent: "x", runs_in: "background", run: () => void ran.push("closed") },
  });
  const response = await create_router(deps).run({ invocations: [{ id: "tab.fail" }, { id: "tab.close" }], mode: "normal" });
  assert.equal(response.ok, false);
  assert.deepEqual(ran, []);
  assert.deepEqual(log, ["refuse 7 nothing to do"]);
});

// A content step the test answers by hand, like a hint pick that the user has not made yet.
function pending_content() {
  const replies: ((reply: unknown) => void)[] = [];
  return { send_to_tab: () => new Promise<unknown>((resolve) => replies.push(resolve)), reply: (value: unknown) => replies.shift()!(value) };
}
const waiting_commands = (ran: string[]) => ({
  "hint.run": { label: "Hint", intent: "x", runs_in: "content" as const, run: () => {} },
  "tab.next": { label: "Next", intent: "x", runs_in: "background" as const, run: () => void ran.push("tab.next") },
});

test("a waiting content step resumes the sequence after the pick, and not before", async () => {
  const ran: string[] = [];
  const pick = pending_content();
  const { deps } = make_fake(waiting_commands(ran), { send_to_tab: pick.send_to_tab });
  const running = create_router(deps).run({ invocations: [{ id: "hint.run" }, { id: "tab.next" }], mode: "normal" });
  await turn();
  assert.deepEqual(ran, []);
  pick.reply({ ok: true });
  assert.deepEqual(await running, { ok: true });
  assert.deepEqual(ran, ["tab.next"]);
});

test("Escape on a waiting content step cancels the rest with no toast", async () => {
  const ran: string[] = [];
  const pick = pending_content();
  const { deps, log } = make_fake(waiting_commands(ran), { send_to_tab: pick.send_to_tab });
  const running = create_router(deps).run({ invocations: [{ id: "hint.run" }, { id: "tab.next" }], mode: "normal" });
  await turn();
  pick.reply({ ok: true, cancelled: true });
  assert.deepEqual(await running, { ok: true, cancelled: true });
  assert.deepEqual(ran, []);
  assert.deepEqual(log, []);
});

test("a background step then a content step sends the content step to the tab that is active by then", async () => {
  let active = 1;
  const sent: [number, number | undefined][] = [];
  const { deps } = make_fake(
    {
      "tab.next": { label: "Next", intent: "x", runs_in: "background", run: () => void active++ },
      "scroll.to": { label: "Scroll", intent: "x", runs_in: "content", run: () => {} },
    },
    {
      active_tab: async () => ({ tab_id: active, window_id: 1, url: undefined }),
      send_to_tab: async (tab_id, _message, frame_id) => void sent.push([tab_id, frame_id]),
    },
  );
  await create_router(deps).run({ invocations: [{ id: "tab.next" }, { id: "scroll.to" }], mode: "normal", sender_tab_id: 1, frame_id: 3 });
  assert.deepEqual(sent, [[2, 0]]);
});

test("a context source that expands to text the schema refuses is refused before the command runs", async () => {
  const seen: unknown[] = [];
  const commands = {
    "settings.set": {
      label: "Set",
      intent: "x",
      name: "set",
      params: [
        { name: "name", type: "string", values: ["light_intensity"], strict: true },
        { name: "value", type: "string", main: true, optional: true, value_of: "name" },
      ],
      runs_in: "background",
      run: (_ctx: unknown, args: unknown) => void seen.push(args),
    },
    "page.pick": {
      label: "Pick",
      intent: "x",
      params: [{ name: "pick", type: "string", main: true, pattern: "^[a-z]+$" }],
      runs_in: "background",
      run: (_ctx: unknown, args: unknown) => void seen.push(args),
    },
  } as const;
  const bad = make_fake(commands, { ask_selection: async () => "9" });
  const refused = await create_router(bad.deps).run({ invocations: [{ id: "settings.set", args: { name: "light_intensity", value: { from: "selection" } } }], mode: "normal" });
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? "" : refused.refusal.message, /light_intensity: expected a whole number from 1 to 5/);
  const unmatched = await create_router(bad.deps).run({ invocations: [{ id: "page.pick", args: { pick: { from: "selection" } } }], mode: "normal" });
  assert.equal(unmatched.ok, false);
  assert.deepEqual(seen, []);
  const good = make_fake(commands, { ask_selection: async () => "4" });
  assert.deepEqual(await create_router(good.deps).run({ invocations: [{ id: "settings.set", args: { name: "light_intensity", value: { from: "selection" } } }], mode: "normal" }), { ok: true });
  assert.deepEqual(seen, [{ name: "light_intensity", value: "4" }]);
});
