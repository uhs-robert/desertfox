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

test("an empty selection in an explicit @selection arg opens the line, a full one runs", async () => {
  const seen: unknown[] = [];
  const commands = { "site.find": { label: "Find", intent: "x", name: "find", params: [{ name: "query", type: "string", rest: true, main: true }, { name: "where", type: "enum", values: ["here", "tab"], default: "here" }], runs_in: "background", run: (_ctx: unknown, args: unknown) => void seen.push(args) } } as const;
  const empty = make_fake(commands, { ask_selection: async () => "" });
  const key = { id: "site.find", args: { query: { from: "selection" }, where: "tab" } };
  assert.deepEqual(await create_router(empty.deps).run({ invocations: [key], mode: "normal", may_prompt: true }), { ok: true });
  assert.deepEqual(empty.log, ["cmdline 7 0 find tab "]);
  const full = make_fake(commands);
  await create_router(full.deps).run({ invocations: [key], mode: "normal", may_prompt: true });
  assert.deepEqual(seen, [{ query: "chosen text", where: "tab" }]);
  assert.deepEqual(full.log, []);
});

test("a missing required param opens the command line with the command typed in", async () => {
  const { deps, log } = make_fake({
    "open.url": { label: "Open", intent: "x", name: "open", params: [{ name: "url", type: "string" }], runs_in: "background", run: () => assert.fail() },
  });
  assert.deepEqual(await create_router(deps).run({ invocations: [{ id: "open.url" }], mode: "normal", may_prompt: true }), { ok: true });
  assert.deepEqual(log, ["cmdline 7 0 open url="]);
});

test("a prompt opens the line with the prefill resolved now, and runs nothing", async () => {
  const { deps, log } = make_fake({
    "open.url": { label: "Open", intent: "x", name: "open", params: [{ name: "url", type: "string" }, { name: "where", type: "enum", values: ["here", "tab"], default: "here" }], runs_in: "background", run: () => assert.fail() },
  });
  const binding = { id: "open.url", args: { where: "tab" }, prompt: { param: "url", prefill: { from: "current_url" } as const } };
  await create_router(deps).run({ invocations: [binding], mode: "normal", may_prompt: true });
  const bare = { id: "open.url", prompt: { param: "url" } };
  await create_router(deps).run({ invocations: [bare], mode: "normal", may_prompt: true });
  assert.deepEqual(log, ["cmdline 7 0 open url=https://example.org/ tab", "cmdline 7 0 open url="]);
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
    { open_cmdline: async () => { throw new Error("no receiver"); } },
  );
  const response = await create_router(deps).run({ invocations: [{ id: "open.url" }], mode: "normal", may_prompt: true });
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
  assert.deepEqual(log, ["cmdline 7 0 bookmark.add url=https://example.org/"]);
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

test("a prompt that opens the line stops the rest of the sequence", async () => {
  const closed: string[] = [];
  const { deps, log } = make_fake({
    "open.url": { label: "Open", intent: "x", name: "open", params: [{ name: "url", type: "string", main: true }], runs_in: "background", run: () => assert.fail() },
    "tab.close": { label: "Close", intent: "x", runs_in: "background", run: () => void closed.push("closed") },
  });
  const response = await create_router(deps).run({
    invocations: [{ id: "open.url", prompt: { param: "url" } }, { id: "tab.close" }],
    mode: "normal",
    may_prompt: true,
  });
  assert.deepEqual(response, { ok: true });
  assert.deepEqual(log, ["cmdline 7 0 open "]);
  assert.deepEqual(closed, []);
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
