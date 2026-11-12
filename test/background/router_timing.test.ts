import assert from "node:assert/strict";
import { test } from "node:test";
import { create_router } from "../../src/background/router.ts";
import type { RouterDeps } from "../../src/background/router.ts";

const noop_async = async () => undefined;
function deps(run: () => Promise<unknown>, timings: [string, number][]): RouterDeps {
  const commands: Record<string, unknown> = {
    "x.ok": { id: "x.ok", label: "x", runs_in: "background", run },
    "x.content": { id: "x.content", label: "c", runs_in: "content" },
    "debug.perf": { id: "debug.perf", label: "p", runs_in: "background", run },
  };
  return {
    get_command: (id: string) => commands[id] as never,
    get_enum_sources: async () => ({ search_engines: [], containers: [] }),
    active_tab: async () => ({ tab_id: 1, window_id: 1, url: "https://a.test/" }),
    get_tab: async () => ({ tab_id: 1, window_id: 1, url: "https://a.test/" }),
    has_content_script: async () => true,
    ask_selection: noop_async,
    runs_with_empty: async () => false,
    read_clipboard: async () => "",
    bookmark_title: noop_async,
    has_permission: async () => true,
    send_to_tab: async () => ({ ok: true }),
    open_cmdline: noop_async,
    show_refusal: noop_async,
    is_disabled: async () => false,
    repeat_memory: { in_turn: async (work: never) => (work as (u: unknown) => unknown)({}), read: async () => undefined } as never,
    record_step: async () => undefined,
    record_timing: (id, ms) => void timings.push([id, ms]),
  };
}

test("a finished command reports its time, a refusal and debug.perf do not", async () => {
  const timings: [string, number][] = [];
  const router = create_router(deps(async () => ({ ok: true }), timings));
  await router.run({ invocations: [{ id: "x.ok" }], mode: "normal" });
  await router.run({ invocations: [{ id: "debug.perf" }], mode: "normal" });
  assert.deepEqual(timings.map(([id]) => id), ["x.ok"]);
  assert.ok(timings[0]![1] >= 0);

  const refused: [string, number][] = [];
  await create_router(deps(async () => ({ ok: false, message: "no" }), refused)).run({ invocations: [{ id: "x.ok" }], mode: "normal" });
  assert.deepEqual(refused, []);
});

test("a throwing handler and a content command leave no row", async () => {
  const timings: [string, number][] = [];
  const throwing = create_router(deps(async () => Promise.reject(new Error("boom")), timings));
  const response = await throwing.run({ invocations: [{ id: "x.ok" }], mode: "normal" });
  assert.equal(response.ok, false);
  const content = await throwing.run({ invocations: [{ id: "x.content" }], mode: "normal" });
  assert.deepEqual(content, { ok: true });
  assert.deepEqual(timings, []);
});
