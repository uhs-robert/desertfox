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
  assert.deepEqual(log, ["refuse 7 Open needs a page DesertFox runs on"]);
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
  assert.match(log[0]!, /needs a page DesertFox runs on/);
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
    },
  });
  await create_router(deps).run({ invocations: [{ id: "scroll.lines", count: 2 }], mode: "normal", may_prompt: true });
  const one = { id: "scroll.lines", args: { lines: 1 } };
  assert.deepEqual(log, [`send 7 ${JSON.stringify({ type: "run_in_content", invocations: [one, one] })}`]);
});

test("a macro replay's content step runs as a held key's repeat, so a scroll jumps", async () => {
  const { deps, log } = make_fake({ "scroll.to": { label: "Scroll", intent: "x", runs_in: "content" } });
  await create_router(deps).run({ invocations: [{ id: "scroll.to" }], mode: "normal", instant: true });
  assert.deepEqual(log, [`send 7 ${JSON.stringify({ type: "run_in_content", invocations: [{ id: "scroll.to", args: {} }], repeat: true })}`]);
});

test("a content command into a tab without a script refuses and stops the chain", async () => {
  const { deps, log } = make_fake(
    {
      "scroll.lines": { label: "Scroll", intent: "x", runs_in: "content" },
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
      "scroll.lines": { label: "Scroll", intent: "x", runs_in: "content" },
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

test("a sender frame is not used when the sender tab is gone and the active tab takes over", async () => {
  const sent: [number, number | undefined][] = [];
  const { deps } = make_fake(
    { "scroll.lines": { label: "Scroll", intent: "x", runs_in: "content" } },
    { get_tab: async () => undefined, send_to_tab: async (tab_id, _message, frame_id) => void sent.push([tab_id, frame_id]) },
  );
  await create_router(deps).run({ invocations: [{ id: "scroll.lines" }], mode: "normal", sender_tab_id: 99, frame_id: 3 });
  assert.deepEqual(sent, [[7, 0]]);
});

test("a live sender tab keeps its frame while another tab is active", async () => {
  const sent: [number, number | undefined][] = [];
  const { deps } = make_fake(
    { "scroll.lines": { label: "Scroll", intent: "x", runs_in: "content" } },
    { send_to_tab: async (tab_id, _message, frame_id) => void sent.push([tab_id, frame_id]) },
  );
  await create_router(deps).run({ invocations: [{ id: "scroll.lines" }], mode: "normal", sender_tab_id: 99, frame_id: 3 });
  assert.deepEqual(sent, [[99, 3]]);
});

test("a tab switch before step 0 does not move a leading content step or a leading background step", async () => {
  const sent: [number, number | undefined][] = [];
  const closed: (number | undefined)[] = [];
  const commands = {
    "hint.run": { label: "Hint", intent: "x", runs_in: "content" as const },
    "tab.close": { label: "Close", intent: "x", runs_in: "background" as const, run: (ctx: { tab_id: number | undefined }) => void closed.push(ctx.tab_id) },
  };
  const { deps } = make_fake(commands, {
    active_tab: async () => ({ tab_id: 2, window_id: 1, url: undefined }),
    send_to_tab: async (tab_id, _message, frame_id) => void sent.push([tab_id, frame_id]),
  });
  const router = create_router(deps);
  await router.run({ invocations: [{ id: "hint.run" }], mode: "normal", sender_tab_id: 1, frame_id: 4 });
  await router.run({ invocations: [{ id: "tab.close" }], mode: "normal", sender_tab_id: 1, frame_id: 4 });
  assert.deepEqual(sent, [[1, 4]]);
  assert.deepEqual(closed, [1]);
});

test("a switch during a waiting step 0 sends step 1 to the tab that is active by then", async () => {
  let active = 1;
  const ran: (number | undefined)[] = [];
  const pick = pending_content();
  const { deps } = make_fake(
    {
      "hint.run": { label: "Hint", intent: "x", runs_in: "content" },
      "tab.next": { label: "Next", intent: "x", runs_in: "background", run: (ctx) => void ran.push(ctx.tab_id) },
    },
    { active_tab: async () => ({ tab_id: active, window_id: 1, url: undefined }), send_to_tab: pick.send_to_tab },
  );
  const running = create_router(deps).run({ invocations: [{ id: "hint.run" }, { id: "tab.next" }], mode: "normal", sender_tab_id: 1 });
  await turn();
  active = 2;
  pick.reply({ ok: true });
  await running;
  assert.deepEqual(ran, [2]);
});

test("a repeated step 0 pins only its first time, and a repeated background step follows the active tab", async () => {
  let active = 2;
  const seen: (number | undefined)[] = [];
  const { deps } = make_fake(
    { "tab.next": { label: "Next", intent: "x", runs_in: "background", count: "repeat", run: (ctx) => void (seen.push(ctx.tab_id), active++) } },
    { active_tab: async () => ({ tab_id: active, window_id: 1, url: undefined }) },
  );
  await create_router(deps).run({ invocations: [{ id: "tab.next", count: 3 }], mode: "normal", sender_tab_id: 1 });
  assert.deepEqual(seen, [1, 3, 4]);
});

test("a repeated content step sends every repeat in one message to the sender tab", async () => {
  const sent: [number, unknown][] = [];
  const { deps } = make_fake(
    { "scroll.lines": { label: "Scroll", intent: "x", runs_in: "content", count: "repeat" } },
    { send_to_tab: async (tab_id, message) => void sent.push([tab_id, (message as { invocations: unknown[] }).invocations.length]) },
  );
  await create_router(deps).run({ invocations: [{ id: "scroll.lines", count: 3 }], mode: "normal", sender_tab_id: 1 });
  assert.deepEqual(sent, [[1, 3]]);
});

test("a sender tab that fails to look up falls back to the active tab without throwing", async () => {
  const sent: number[] = [];
  const { deps } = make_fake(
    { "scroll.lines": { label: "Scroll", intent: "x", runs_in: "content" } },
    { get_tab: async () => { throw new Error("no tab"); }, send_to_tab: async (tab_id) => void sent.push(tab_id) },
  );
  assert.deepEqual(await create_router(deps).run({ invocations: [{ id: "scroll.lines" }], mode: "normal", sender_tab_id: 99 }), { ok: true });
  assert.deepEqual(sent, [7]);
});

test("a sender frame that is gone after navigation refuses in the sender tab and does not throw", async () => {
  const log: string[] = [];
  const { deps } = make_fake(
    { "scroll.lines": { label: "Scroll", intent: "x", runs_in: "content" } },
    { send_to_tab: async () => { throw new Error("no frame"); }, show_refusal: async (tab_id, refusal, frame_id) => void log.push(`refuse ${tab_id} ${frame_id} ${refusal.message}`) },
  );
  const response = await create_router(deps).run({ invocations: [{ id: "scroll.lines" }], mode: "normal", sender_tab_id: 1, frame_id: 5 });
  assert.equal(response.ok, false);
  assert.deepEqual(log, ["refuse 1 5 Scroll needs a page DesertFox runs on"]);
});

test("the private flag comes from the sender tab, not the active tab", async () => {
  const commands = { "tab.close": { label: "Close", intent: "x", runs_in: "background" as const, repeatable: true, run: () => {} } };
  const { deps, slots } = make_fake(commands, {
    active_tab: async () => ({ tab_id: 2, window_id: 1, url: undefined, incognito: false }),
    get_tab: async (tab_id) => ({ tab_id, window_id: 1, url: undefined, incognito: true }),
  });
  await create_router(deps).run({ invocations: [{ id: "tab.close" }], mode: "normal", sender_tab_id: 1 });
  assert.equal(slots.private?.length, 1);
  assert.equal(slots.normal, undefined);
});

test("two overlapping runs each keep their own sender tab", async () => {
  const sent: number[] = [];
  const releases: (() => void)[] = [];
  const { deps } = make_fake(
    { "scroll.lines": { label: "Scroll", intent: "x", runs_in: "content" } },
    {
      // Every lookup of a run waits, so the runs interleave at each one.
      get_tab: (tab_id) => new Promise((resolve) => releases.push(() => resolve({ tab_id, window_id: 1, url: undefined }))),
      send_to_tab: async (tab_id) => void sent.push(tab_id),
    },
  );
  const router = create_router(deps);
  const first = router.run({ invocations: [{ id: "scroll.lines" }], mode: "normal", sender_tab_id: 1 });
  const second = router.run({ invocations: [{ id: "scroll.lines" }], mode: "normal", sender_tab_id: 2 });
  const settled = Promise.all([first, second]);
  for (let round = 0; round < 10; round++) {
    await turn();
    releases.splice(0).reverse().forEach((release) => release());
  }
  await settled;
  assert.deepEqual(sent.sort(), [1, 2]);
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
    "page.look": { label: "Look", intent: "x", runs_in: "content" as const },
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
      "page.look": { label: "Look", intent: "x", runs_in: "content" },
      "tab.close": { label: "Close", intent: "x", runs_in: "background", run: () => void ran.push("closed") },
    },
    { send_to_tab: async () => { throw new Error("The message channel closed"); } },
  );
  const response = await create_router(deps).run({ invocations: [{ id: "page.look" }, { id: "tab.close" }], mode: "normal" });
  assert.equal(response.ok, false);
  assert.deepEqual(ran, []);
  assert.deepEqual(log, ["refuse 7 Look needs a page DesertFox runs on"]);
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
  "hint.run": { label: "Hint", intent: "x", runs_in: "content" as const },
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
      "scroll.to": { label: "Scroll", intent: "x", runs_in: "content" },
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

test("an optional param with a blank expansion reaches the handler as empty, an empty selection keeps its marker as empty text, and a content command is rechecked", async () => {
  const seen: unknown[] = [];
  const commands = {
    "page.name": {
      label: "Name",
      intent: "x",
      params: [{ name: "name", type: "string", main: true, optional: true, values: ["a"], strict: true }],
      runs_in: "background",
      run: (_ctx: unknown, args: unknown) => void seen.push(args),
    },
    "page.pick": {
      label: "Pick",
      intent: "x",
      params: [{ name: "pick", type: "string", main: true, pattern: "^[a-z]+$" }],
      runs_in: "content",
    },
  } as const;
  const blank = make_fake(commands, { read_clipboard: async () => "   ", ask_selection: async () => "" });
  const pick = { name: { from: "clipboard" } };
  assert.deepEqual(await create_router(blank.deps).run({ invocations: [{ id: "page.name", args: pick }], mode: "normal" }), { ok: true });
  assert.deepEqual(seen, [{ name: "" }]);
  const empty = make_fake(commands, { ask_selection: async () => "", runs_with_empty: async () => true });
  const calls = seen.length;
  assert.deepEqual(await create_router(empty.deps).run({ invocations: [{ id: "page.name", args: { name: { from: "selection" } } }], mode: "normal" }), { ok: true });
  assert.equal(seen.length, calls + 1);
  assert.deepEqual(seen.at(-1), { name: "" });
  const content = make_fake(commands, { ask_selection: async () => "9" });
  const refused = await create_router(content.deps).run({ invocations: [{ id: "page.pick", args: { pick: { from: "selection" } } }], mode: "normal" });
  assert.equal(refused.ok, false);
  assert.ok(content.log.every((entry) => !entry.startsWith("send")), content.log.join());
});

test("while off nothing runs: a slot chord, a snippet call or a replay is refused with no side effect", async () => {
  const seen: unknown[] = [];
  const { deps } = make_fake(
    { "tab.close": { label: "Close Tab", intent: "x", params: [], runs_in: "background", run: () => void seen.push("ran") } },
    { is_disabled: async () => true },
  );
  const response = await create_router(deps).run({ invocations: [{ id: "tab.close" }], mode: "normal" });
  assert.deepEqual(response, { ok: false, refusal: { id: "desertfox.off", message: "DesertFox is off" } });
  assert.deepEqual(seen, []);
});

test("a bookmark_title prefill types the title of the page's bookmark, and nothing when the page has none", async () => {
  const commands = { "bookmark.rename": { label: "Rename", intent: "x", params: [{ name: "title", type: "string", rest: true, main: true }], runs_in: "background", run: () => assert.fail() } } as const;
  const binding = { id: "bookmark.rename", prompt: { param: "title", prefill: { from: "bookmark_title" } as const } };
  const asked: (string | undefined)[] = [];
  const titled = make_fake(commands, { bookmark_title: async (url) => (asked.push(url), "Saved title") });
  await create_router(titled.deps).run({ invocations: [binding], mode: "normal", may_prompt: true });
  assert.deepEqual([titled.log, asked], [["cmdline 7 0 bookmark.rename Saved title"], ["https://example.org/"]]);
  const none = make_fake(commands, { bookmark_title: async () => undefined });
  await create_router(none.deps).run({ invocations: [binding], mode: "normal", may_prompt: true });
  assert.deepEqual(none.log, ["cmdline 7 0 bookmark.rename "]);
});

test("a lost reply is done when the caller says the tab navigated, and refuses when it says no or throws", async () => {
  const cases: [string, () => Promise<boolean>, boolean][] = [
    ["navigated", async () => true, true],
    ["did not navigate", async () => false, false],
    ["threw", async () => Promise.reject(new Error("gone")), false],
  ];
  for (const [name, lost_reply_is_done, is_done] of cases) {
    const log: string[] = [];
    const { deps } = make_fake(
      { "scroll.lines": { label: "Scroll", intent: "x", runs_in: "content" } },
      { send_to_tab: async () => { throw new Error("page unloaded"); }, show_refusal: async (_tab_id, refusal) => void log.push(refusal.message) },
    );
    const response = await create_router(deps).run({ invocations: [{ id: "scroll.lines" }], mode: "normal", sender_tab_id: 1, lost_reply_is_done });
    assert.equal(response.ok, is_done, name);
    assert.deepEqual(log, is_done ? [] : ["Scroll needs a page DesertFox runs on"], name);
  }
});

test("a content step with no page to run on names its step only during a replay", async () => {
  const cases: [string, number | undefined, string][] = [
    ["a typed key", undefined, "Scroll needs a page DesertFox runs on"],
    ["a replay step", 3, "Macro stopped at step 3: needs a page DesertFox runs on"],
  ];
  for (const [name, macro_step, message] of cases) {
    for (const lost of [false, true]) {
      const log: string[] = [];
      const { deps } = make_fake(
        { "scroll.lines": { label: "Scroll", intent: "x", runs_in: "content", needs: lost ? [] : ["content"] } },
        { has_content_script: async () => false, send_to_tab: async () => { throw new Error("no receiver"); }, show_refusal: async (_tab_id, refusal) => void log.push(refusal.message) },
      );
      await create_router(deps).run({ invocations: [{ id: "scroll.lines" }], mode: "normal", sender_tab_id: 1, ...(macro_step === undefined ? {} : { macro_step }) });
      assert.deepEqual(log, [message], `${name}, ${lost ? "send fails" : "unmet need"}`);
    }
  }
});

const closer = (seen: number[]) => ({
  label: "Close",
  intent: "x",
  runs_in: "background" as const,
  count: "repeat" as const,
  repeat_limit: 20,
  run: () => void seen.push(1),
});

test("a count over the repeat limit is refused, names the count, limit and command, and runs nothing", async () => {
  const seen: number[] = [];
  const { deps, log } = make_fake({ "tab.close": closer(seen) });
  const response = await create_router(deps).run({ invocations: [{ id: "tab.close", count: 100 }], mode: "normal" });
  assert.deepEqual(response, { ok: false, refusal: { id: "tab.close", message: "A count of 100 is over the limit of 20 for tab.close" } });
  assert.deepEqual(seen, []);
  assert.deepEqual(log, ["refuse 7 A count of 100 is over the limit of 20 for tab.close"]);
});

test("a count at exactly the repeat limit runs, and so does no count", async () => {
  const seen: number[] = [];
  const { deps } = make_fake({ "tab.close": closer(seen) });
  const router = create_router(deps);
  assert.deepEqual(await router.run({ invocations: [{ id: "tab.close", count: 20 }], mode: "normal" }), { ok: true });
  assert.equal(seen.length, 20);
  await router.run({ invocations: [{ id: "tab.close" }], mode: "normal" });
  assert.equal(seen.length, 21);
});

test("a sequence with a later step over the limit runs no step", async () => {
  const seen: number[] = [];
  const { deps } = make_fake({ "tab.close": closer(seen), "tab.next": { label: "Next", intent: "x", runs_in: "background", run: () => void seen.push(0) } });
  const response = await create_router(deps).run({ invocations: [{ id: "tab.next" }, { id: "tab.close", count: 21 }], mode: "normal" });
  assert.equal(response.ok, false);
  assert.deepEqual(seen, []);
});

test("the limit gates a param-rule count prefix but not a typed param", async () => {
  const seen: unknown[] = [];
  const { deps } = make_fake({
    "tab.unload": { label: "Unload", intent: "x", runs_in: "background", params: [{ name: "count", type: "int", default: 1 }], count: { param: "count" }, repeat_limit: 20, run: (_ctx, args) => void seen.push(args.count) },
  });
  const router = create_router(deps);
  assert.equal((await router.run({ invocations: [{ id: "tab.unload", count: 21 }], mode: "normal" })).ok, false);
  assert.equal((await router.run({ invocations: [{ id: "tab.unload", args: { count: 100 } }], mode: "normal" })).ok, true);
  assert.deepEqual(seen, [100]);
});

test("a prompt step that may prompt drops its count and is not gated, but is refused when it may not prompt", async () => {
  const seen: number[] = [];
  const commands = { "tab.close": { ...closer(seen), name: "close", params: [{ name: "q", type: "string" as const, main: true }] } };
  const step = { id: "tab.close", count: 100, prompt: { param: "q" } };
  const prompting = make_fake(commands);
  assert.deepEqual(await create_router(prompting.deps).run({ invocations: [step], mode: "normal", may_prompt: true }), { ok: true });
  assert.ok(prompting.log.some((line) => line.startsWith("cmdline")));
  const silent = make_fake(commands);
  assert.equal((await create_router(silent.deps).run({ invocations: [step], mode: "normal" })).ok, false);
  assert.deepEqual(seen, []);
});

test("a replayed step over the limit is refused with instant set", async () => {
  const seen: number[] = [];
  const { deps } = make_fake({ "tab.close": closer(seen) });
  const response = await create_router(deps).run({ invocations: [{ id: "tab.close", count: 50 }], mode: "normal", instant: true });
  assert.equal(response.ok, false);
  assert.deepEqual(seen, []);
});
