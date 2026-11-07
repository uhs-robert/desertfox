import assert from "node:assert/strict";
import { test } from "node:test";
import { close_tabs, move_tabs, reopen_in_container, reopen_tabs_in_container, set_muted, set_pinned } from "../../src/background/tab_actions.ts";
import type { TabActionDeps } from "../../src/background/tab_actions.ts";

function make_deps() {
  const log: string[] = [];
  const deps: TabActionDeps = {
    set_muted: async (ids, muted) => void log.push(`mute ${ids.join(",")} ${muted}`),
    set_pinned: async (ids, pinned) => void log.push(`pin ${ids.join(",")} ${pinned}`),
    move: async (ids, index) => void log.push(`move ${ids.join(",")} ${index}`),
    open_tab: async (open) => void log.push(`open ${open.url} ${open.index} ${open.cookie_store_id} ${open.pinned}${open.active === undefined ? "" : ` active=${open.active}`}`),
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

test("reopen opens every tab where it was, then closes its old one", async () => {
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
  assert.deepEqual(log, ["open https://a.test/ 2 firefox-container-1 false", "remove 10", "open https://b.test/ 5 firefox-container-1 true", "remove 11"]);
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

test("tabs given out of order reopen in tab bar order at their own places", async () => {
  const { deps, log } = make_deps();
  const reopened = await reopen_in_container(
    deps,
    1,
    [
      { id: 11, index: 5, pinned: false, url: "https://b.test/" },
      { id: 10, index: 2, pinned: false, url: "https://a.test/" },
    ],
    "c",
  );
  assert.deepEqual(reopened, [10, 11]);
  assert.deepEqual(log, ["open https://a.test/ 2 c false", "remove 10", "open https://b.test/ 5 c false", "remove 11"]);
});

test("a failed open stops the run and leaves no duplicate", async () => {
  const { deps, log } = make_deps();
  const failing: TabActionDeps = {
    ...deps,
    open_tab: async (open) => {
      if (open.url.startsWith("data:")) throw new Error("illegal url");
      await deps.open_tab(open);
    },
  };
  const tabs = [
    { id: 10, index: 0, pinned: false, url: "https://a.test/" },
    { id: 11, index: 1, pinned: false, url: "data:text/html,x" },
    { id: 12, index: 2, pinned: false, url: "https://c.test/" },
  ];
  await assert.rejects(reopen_in_container(failing, 1, tabs, "c"), /illegal url/);
  assert.deepEqual(log, ["open https://a.test/ 0 c false", "remove 10"]);
});

test("close_tabs closes each tab on its own, so a tab that closed already does not stop the rest", async () => {
  const closed: number[] = [];
  const deps = {
    remove: async ([id]: number[]) => {
      if (id === 2) throw new Error("Invalid tab ID");
      closed.push(id!);
    },
  };
  assert.equal(await close_tabs(deps, [1, 2, 3]), 2);
  assert.deepEqual(closed, [1, 3]);
});

test("many-tab reopen skips tabs already in the container and activates none of the new tabs", async () => {
  const { deps, log } = make_deps();
  const reopened = await reopen_tabs_in_container(
    deps,
    [
      { id: 12, index: 7, pinned: false, url: "https://c.test/", window_id: 1, cookie_store_id: "work" },
      { id: 11, index: 5, pinned: true, url: "https://b.test/", window_id: 1, cookie_store_id: undefined },
      { id: 10, index: 2, pinned: false, url: "https://a.test/", window_id: 2, cookie_store_id: "firefox-default" },
    ],
    "work",
  );
  assert.deepEqual(reopened, [10, 11]);
  assert.deepEqual(log, ["open https://a.test/ 2 work false active=false", "remove 10", "open https://b.test/ 5 work true active=false", "remove 11"]);
});

test("many-tab reopen skips a tab that fails and goes on, and every new tab opens inactive", async () => {
  const log: string[] = [];
  const deps: Pick<TabActionDeps, "open_tab" | "remove"> = {
    open_tab: async (open) => {
      if (open.url.startsWith("about:")) throw new Error("not allowed");
      log.push(`open ${open.url} active=${open.active}`);
    },
    remove: async (ids) => void log.push(`remove ${ids.join(",")}`),
  };
  const reopened = await reopen_tabs_in_container(
    deps,
    [
      { id: 1, index: 0, pinned: false, url: "about:config", window_id: 1 },
      { id: 2, index: 1, pinned: false, url: undefined, window_id: 1 },
      { id: 3, index: 2, pinned: false, url: "https://b.test/", window_id: 1 },
      { id: 4, index: 3, pinned: false, url: "https://c.test/", window_id: 1 },
    ],
    "work",
  );
  assert.deepEqual(reopened, [3, 4]);
  assert.deepEqual(log, ["open https://b.test/ active=false", "remove 3", "open https://c.test/ active=false", "remove 4"]);
});

test("many-tab reopen skips a tab whose old copy fails to close and counts it as not moved", async () => {
  const { deps, log } = make_deps();
  const failing = { ...deps, remove: async (ids: number[]) => { if (ids[0] === 10) throw new Error("gone"); log.push(`remove ${ids.join(",")}`); } };
  const reopened = await reopen_tabs_in_container(failing, [{ id: 10, index: 0, pinned: false, url: "https://a.test/", window_id: 1 }, { id: 11, index: 1, pinned: false, url: "https://b.test/", window_id: 1 }], "work");
  assert.deepEqual(reopened, [11]);
});
