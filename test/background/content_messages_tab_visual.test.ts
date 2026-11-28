// The run handler notes each `tab.visual` run for the tab range's action wait, as the message arrives.
import assert from "node:assert/strict";
import { test } from "node:test";
import { content_handlers } from "../../src/background/content_messages.ts";
import type { ContentDeps } from "../../src/background/content_messages.ts";

type Sender = browser.runtime.MessageSender;
const page: Sender = { id: "test@desertfox", url: "https://example.com/", frameId: 0, tab: { id: 4, windowId: 1, url: "https://example.com/" } as browser.tabs.Tab };

function make() {
  const noted: number[] = [];
  const answered: number[] = [];
  const routed: unknown[] = [];
  const deps = {
    is_own_page: () => false,
    get_config: () => Promise.resolve({ search_engines: {}, settings: {} }),
    media_discovery: { key_ran: async () => {} },
    macro_replay: { wait_unless_from: async () => {} },
    cmdline: { target_of: async () => undefined },
    cmdline_panel: { asker_of: async () => undefined, closed: async () => {} },
    router: { run: async (request: { noted_run?: number }) => (routed.push(request.noted_run), { ok: true }) },
    router_deps: {},
    tab_visual: { note_run: (tab_id: number) => (noted.push(tab_id), 40 + noted.length), answered: (id: number) => void answered.push(id) },
  } as unknown as ContentDeps;
  const run = (ids: string[]) => content_handlers(deps).run.run({ type: "run", mode: "tab_visual", invocations: ids.map((id) => ({ id, args: {} })) } as never, page);
  return { noted, answered, routed, run };
}

test("a tab.visual run is noted with its tab before the handler awaits anything, and carries its id to the router", async () => {
  const { noted, answered, routed, run } = make();
  const answer = run(["tab.visual"]);
  assert.deepEqual(noted, [4]);
  assert.deepEqual(answered, [41]);
  await answer;
  assert.deepEqual(routed, [41]);
});

test("a run that also holds tab.act is not noted, and other runs are not either", async () => {
  const { noted, routed, run } = make();
  await run(["tab.visual", "tab.act"]);
  await run(["tab.act"]);
  await run(["scroll.down"]);
  assert.deepEqual(noted, []);
  assert.deepEqual(routed, [undefined, undefined, undefined]);
});
