import assert from "node:assert/strict";
import { test } from "node:test";
import { create_last_used_tabs } from "../../src/background/last_used_tab.ts";

const NO_WINDOW = -1;

type FakeTab = { window_id: number; incognito: boolean; active: boolean };

// A browser with tabs 11 and 12 in window 1, 21 and 22 in window 2, and 31 and 32 in private window 3. The first tab of each window is active, and window 1 has the focus.
// `hold_writes` keeps every write waiting until `release`.
function make_browser({ set_delay_ms = 0, focused_tab_delay_ms = 0 } = {}) {
  const data = new Map<string, unknown>();
  let writes_held: Promise<void> | undefined;
  let release_writes = () => {};
  const storage = {
    get: async (key: string) => (data.has(key) ? { [key]: structuredClone(data.get(key)) } : {}),
    set: async (items: Record<string, unknown>) => {
      await writes_held;
      if (set_delay_ms) await new Promise((resolve) => setTimeout(resolve, set_delay_ms));
      Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value)));
    },
  };
  const tabs = new Map<number, FakeTab>([
    [11, { window_id: 1, incognito: false, active: true }],
    [12, { window_id: 1, incognito: false, active: false }],
    [21, { window_id: 2, incognito: false, active: true }],
    [22, { window_id: 2, incognito: false, active: false }],
    [31, { window_id: 3, incognito: true, active: true }],
    [32, { window_id: 3, incognito: true, active: false }],
  ]);
  const focus = { window_id: 1 };
  const start = () =>
    create_last_used_tabs({
      storage: storage as never,
      active_tab_of: async (window_id) => {
        // Firefox has no window -1. A tab here makes a missing `NO_WINDOW` guard show in the record.
        if (window_id === -1) return { tab_id: 99, incognito: false };
        const found = [...tabs].find(([, tab]) => tab.window_id === window_id && tab.active);
        return found && { tab_id: found[0], incognito: found[1].incognito };
      },
      is_private: async (tab_id) => tabs.get(tab_id)?.incognito,
      focused_tab: async () => {
        const found = [...tabs].find(([, tab]) => tab.window_id === focus.window_id && tab.active);
        if (focused_tab_delay_ms) await new Promise((resolve) => setTimeout(resolve, focused_tab_delay_ms));
        return found && { window_id: focus.window_id, tab_id: found[0], incognito: found[1].incognito };
      },
    });
  const record = start();
  // What Firefox does on `tabs.update(id, { active: true })`: the tab becomes active and `onActivated` fires.
  const activate = (tab_id: number) => {
    const tab = tabs.get(tab_id)!;
    for (const other of tabs.values()) if (other.window_id === tab.window_id) other.active = false;
    tab.active = true;
    return record.activated(tab_id, tab.window_id);
  };
  const hold_writes = () => void (writes_held = new Promise<void>((resolve) => (release_writes = resolve)));
  return { record, start, tabs, activate, focus, hold_writes, release: () => release_writes() };
}

test("switching tabs in one window records the tab before", async () => {
  const { record, activate } = make_browser();
  await record.focused(1);
  await activate(12);
  assert.equal(await record.previous_of(false), 11);
  await activate(11);
  assert.equal(await record.previous_of(false), 12);
});

test("focusing another window records its active tab without an activation", async () => {
  const { record } = make_browser();
  await record.focused(1);
  await record.focused(2);
  assert.equal(await record.previous_of(false), 11);
});

test("focus leaving Firefox keeps the record, and coming back to the same tab is no switch", async () => {
  const { record } = make_browser();
  await record.focused(1);
  await record.focused(2);
  await record.focused(NO_WINDOW);
  assert.equal(await record.previous_of(false), 11);
  await record.focused(2);
  assert.equal(await record.previous_of(false), 11);
});

test("onActivated and onFocusChanged for one switch, in either order, do not record the tab as its own previous", async () => {
  for (const focus_first of [false, true]) {
    const { record, activate, tabs } = make_browser();
    await record.focused(1);
    if (focus_first) {
      tabs.get(21)!.active = false;
      tabs.get(22)!.active = true;
      await record.focused(2);
      await record.activated(22, 2);
    } else {
      await activate(22);
      await record.focused(2);
    }
    assert.equal(await record.previous_of(false), 11, `focus first: ${focus_first}`);
  }
});

test("an activation in a window without focus is ignored until that window gains focus", async () => {
  const { record, activate } = make_browser();
  await record.focused(1);
  await activate(12);
  await activate(22);
  assert.equal(await record.previous_of(false), 11);
  await record.focused(2);
  assert.equal(await record.previous_of(false), 12);
});

test("the command's own events toggle: a second switch returns to the first tab", async () => {
  const { record, activate } = make_browser();
  await record.focused(1);
  await activate(12);
  await record.focused(2);
  // Each press activates the previous tab, whose window has no focus yet, then focuses that window.
  for (const [tab_id, window_id, expected] of [[12, 1, 21], [21, 2, 12], [12, 1, 21]] as const) {
    assert.equal(await record.previous_of(false), tab_id);
    void activate(tab_id);
    void record.focused(window_id);
    assert.equal(await record.previous_of(false), expected);
  }
});

test("a read right after a switch waits for the queued write", async () => {
  const { record, activate } = make_browser({ set_delay_ms: 10 });
  await record.focused(1);
  void activate(12);
  assert.equal(await record.previous_of(false), 11);
  void record.focused(2);
  assert.equal(await record.previous_of(false), 12);
});

test("closing the previous tab, or the whole window it is in, clears it", async () => {
  const { record, activate, tabs } = make_browser();
  await record.focused(1);
  await activate(12);
  await record.removed(22);
  assert.equal(await record.previous_of(false), 11);
  tabs.delete(11);
  await record.removed(11);
  assert.equal(await record.previous_of(false), undefined);

  await record.focused(2);
  assert.equal(await record.previous_of(false), 12);
  // Firefox reports each tab of a closing window, then the window.
  tabs.delete(12);
  await record.removed(12);
  await record.window_removed(1);
  assert.equal(await record.previous_of(false), undefined);
});

test("after the focused window closes, an activation in another window counts", async () => {
  const { record, activate } = make_browser();
  await record.focused(1);
  await record.window_removed(1);
  await activate(22);
  assert.equal(await record.previous_of(false), 11);
});

test("private and normal windows keep separate records", async () => {
  const { record, activate } = make_browser();
  await record.focused(1);
  await record.focused(3);
  assert.equal(await record.previous_of(true), undefined);
  assert.equal(await record.previous_of(false), undefined);
  await record.focused(2);
  assert.equal(await record.previous_of(false), 11);
  await record.focused(3);
  await record.focused(1);
  assert.equal(await record.previous_of(false), 21);
  await activate(12);
  assert.equal(await record.previous_of(false), 11);
  assert.equal(await record.previous_of(true), undefined);
});

test("a background restart keeps the record", async () => {
  const { record, start } = make_browser();
  await record.focused(1);
  await record.focused(2);
  const restarted = start();
  assert.equal(await restarted.previous_of(false), 11);
  await restarted.focused(1);
  assert.equal(await restarted.previous_of(false), 21);
});

test("a failing write warns and the next write still runs", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const data = new Map<string, unknown>();
  let fail_next = true;
  const record = create_last_used_tabs({
    storage: {
      get: async (key: string) => (data.has(key) ? { [key]: data.get(key) } : {}),
      set: async (items: Record<string, unknown>) => {
        if (fail_next) {
          fail_next = false;
          throw new Error("quota");
        }
        Object.entries(items).forEach(([key, value]) => data.set(key, value));
      },
    } as never,
    active_tab_of: async (window_id) => ({ tab_id: window_id * 10, incognito: false }),
    is_private: async () => false,
    focused_tab: async () => undefined,
  });
  await record.focused(1);
  assert.equal(warn.mock.callCount(), 1);
  await record.focused(1);
  await record.focused(2);
  assert.equal(await record.previous_of(false), 10);
});

test("the focus event takes the tab in view when it fires, not one activated while an earlier write waits", async () => {
  const { record, activate, hold_writes, release } = make_browser();
  await record.focused(1);
  hold_writes();
  void record.removed(99);
  void record.focused(2);
  void activate(22);
  release();
  assert.equal(await record.previous_of(false), 21);
});

test("closing a private tab clears it from the private record", async () => {
  const { record, activate, tabs } = make_browser();
  await record.focused(3);
  await activate(32);
  assert.equal(await record.previous_of(true), 31);
  tabs.delete(31);
  await record.removed(31);
  assert.equal(await record.previous_of(true), undefined);
});

test("a fresh session seeds the tab in view, so the first switch has a previous tab", async () => {
  const { record, activate } = make_browser({ focused_tab_delay_ms: 10 });
  void record.seed();
  void activate(12);
  assert.equal(await record.previous_of(false), 11);
});

test("the seed keeps a record that survived a background restart", async () => {
  const { record, start, focus } = make_browser();
  await record.focused(1);
  await record.focused(2);
  focus.window_id = 3;
  const restarted = start();
  await restarted.seed();
  assert.equal(await restarted.previous_of(false), 11);
  assert.equal(await restarted.previous_of(true), undefined);
});
