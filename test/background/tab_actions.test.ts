import assert from "node:assert/strict";
import { test } from "node:test";
import { move_tabs, reopen_in_container, set_muted, set_pinned } from "../../src/background/tab_actions.ts";
import type { TabActionDeps } from "../../src/background/tab_actions.ts";

function make_deps() {
  const log: string[] = [];
  const deps: TabActionDeps = {
    set_muted: async (ids, muted) => void log.push(`mute ${ids.join(",")} ${muted}`),
    set_pinned: async (ids, pinned) => void log.push(`pin ${ids.join(",")} ${pinned}`),
    move: async (ids, index) => void log.push(`move ${ids.join(",")} ${index}`),
    open_tab: async (open) => void log.push(`open ${open.url} ${open.index} ${open.cookie_store_id} ${open.pinned}`),
    remove: async (ids) => void log.push(`remove ${ids.join(",")}`),
  };
  return { deps, log };
}

test("mute, pin and move pass the whole list in one call", async () => {
  const { deps, log } = make_deps();
  await set_muted(deps, [1, 2, 3], true);
  await set_pinned(deps, [4, 5], false);
  await move_tabs(deps, [6, 7], 2);
  assert.deepEqual(log, ["mute 1,2,3 true", "pin 4,5 false", "move 6,7 2"]);
});

test("an empty list calls nothing", async () => {
  const { deps, log } = make_deps();
  await set_muted(deps, [], true);
  await set_pinned(deps, [], true);
  await move_tabs(deps, [], 0);
  assert.deepEqual(log, []);
});

test("reopen opens every tab where it was, then closes the old ones together", async () => {
  const { deps, log } = make_deps();
  const reopened = await reopen_in_container(
    deps,
    1,
    [
      { id: 10, index: 2, pinned: false, url: "https://a.test/" },
      { id: 11, index: 5, pinned: true, url: "https://b.test/" },
    ],
    "firefox-container-1",
  );
  assert.deepEqual(reopened, [10, 11]);
  assert.deepEqual(log, ["open https://a.test/ 2 firefox-container-1 false", "open https://b.test/ 6 firefox-container-1 true", "remove 10,11"]);
});

test("a tab with no address stays open", async () => {
  const { deps, log } = make_deps();
  const reopened = await reopen_in_container(
    deps,
    1,
    [
      { id: 10, index: 0, pinned: false, url: undefined },
      { id: 11, index: 1, pinned: false, url: "https://b.test/" },
    ],
    "c",
  );
  assert.deepEqual(reopened, [11]);
  assert.deepEqual(log, ["open https://b.test/ 1 c false", "remove 11"]);
});

test("nothing reopens and nothing closes when no tab has an address", async () => {
  const { deps, log } = make_deps();
  assert.deepEqual(await reopen_in_container(deps, 1, [{ id: 10, index: 0, pinned: false, url: undefined }], "c"), []);
  assert.deepEqual(log, []);
});
