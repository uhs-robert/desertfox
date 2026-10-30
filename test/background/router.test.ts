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

test("an empty selection refuses", async () => {
  const { deps, log } = make_fake(
    { "open.go": { label: "Go", intent: "x", params: [{ name: "q", type: "string", default: { from: "selection" } }], runs_in: "background", run: () => {} } },
    { ask_selection: async () => "" },
  );
  const response = await create_router(deps).run({ invocations: [{ id: "open.go" }], mode: "normal" });
  assert.equal(response.ok, false);
  assert.match(log[0]!, /^refuse 7 q: selection is not available/);
});

test("a missing required param refuses with the phase 2 message", async () => {
  const { deps, log } = make_fake({
    "open.url": { label: "Open", intent: "x", params: [{ name: "url", type: "string" }], runs_in: "background", run: () => assert.fail() },
  });
  await create_router(deps).run({ invocations: [{ id: "open.url" }], mode: "normal" });
  assert.deepEqual(log, ["refuse 7 Open needs the command line (phase 2)"]);
});

test("a bad arg, an unknown id and an unmet need refuse", async () => {
  const { deps, log } = make_fake(
    {
      "a.b": { label: "AB", intent: "x", params: [{ name: "n", type: "int", default: 1 }], runs_in: "background", needs: ["content"], run: () => {} },
    },
    { has_content_script: async (id) => id !== 7 },
  );
  const router = create_router(deps);
  await router.run({ invocations: [{ id: "a.b" }], mode: "normal" });
  await router.run({ invocations: [{ id: "nope.nope" }], mode: "normal" });
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
  await create_router(deps).run({ invocations: [{ id: "scroll.lines", count: 2 }], mode: "normal" });
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
  const response = await create_router(deps).run({ invocations: [{ id: "scroll.lines" }, { id: "a.b" }], mode: "normal" });
  assert.equal(response.ok, false);
  assert.equal(log.length, 1);
});

test("a throwing handler refuses with its message", async () => {
  const { deps, log } = make_fake({
    "a.b": { label: "AB", intent: "x", runs_in: "background", run: () => { throw new Error("boom"); } },
  });
  await create_router(deps).run({ invocations: [{ id: "a.b" }], mode: "normal" });
  assert.deepEqual(log, ["refuse 7 boom"]);
});
