import assert from "node:assert/strict";
import { test } from "node:test";
import { create_model_client } from "../../../src/cmdline/completion/model_client.ts";
import type { TabRow } from "../../../src/shared/messages.ts";

const row = (id: number, window_id: number, index: number, extra: Partial<TabRow> = {}): TabRow => ({
  id,
  window_id,
  index,
  title: `Tab ${id}`,
  url: `https://site${id}.test/`,
  favicon_url: "",
  site: `site${id}.test`,
  pinned: false,
  muted: false,
  audible: false,
  discarded: false,
  active: false,
  previous: false,
  window_number: window_id === 10 ? 1 : 2,
  container: "",
  container_name: "",
  container_color: "",
  container_icon: "",
  ...extra,
});

function make({ all_windows = true, line_window_id = 10 } = {}) {
  const resyncs: number[] = [];
  let changes = 0;
  const client = create_model_client({ line_window_id, all_windows, request_resync: () => void resyncs.push(1), on_change: () => void changes++ });
  return { client, resyncs, changes: () => changes };
}
const ids = (client: ReturnType<typeof make>["client"]) => client.items()?.map((item) => item.id);

test("nothing is listed before the snapshot, then the snapshot lists", () => {
  const { client, changes } = make();
  assert.equal(client.items(), undefined);
  client.receive({ type: "snapshot", rev: 0, tabs: [row(1, 10, 0), row(2, 10, 1)] });
  assert.deepEqual(ids(client), [1, 2]);
  assert.equal(changes(), 1);
});

test("a patch applies removals first, so an upsert of a removed id stays", () => {
  const { client, changes } = make();
  client.receive({ type: "snapshot", rev: 0, tabs: [row(1, 10, 0), row(2, 10, 1)] });
  client.receive({ type: "patch", rev: 1, upserts: [row(2, 10, 0, { title: "Again" }), row(3, 10, 1)], removed: [1, 2] });
  assert.deepEqual(client.items()?.map((item) => [item.id, item.number, item.title]), [[2, 1, "Again"], [3, 2, "Tab 3"]]);
  assert.equal(changes(), 2);
});

test("a rev gap asks one resync, drops patches until the snapshot lands, and then patches apply again", () => {
  const { client, resyncs } = make();
  client.receive({ type: "snapshot", rev: 4, tabs: [row(1, 10, 0)] });
  client.receive({ type: "patch", rev: 6, upserts: [row(2, 10, 1)], removed: [] });
  client.receive({ type: "patch", rev: 7, upserts: [row(3, 10, 2)], removed: [] });
  assert.equal(resyncs.length, 1);
  assert.deepEqual(ids(client), [1]);
  client.receive({ type: "snapshot", rev: 7, tabs: [row(1, 10, 0), row(2, 10, 1), row(3, 10, 2)] });
  client.receive({ type: "patch", rev: 8, upserts: [], removed: [3] });
  assert.deepEqual(ids(client), [1, 2]);
  assert.equal(resyncs.length, 1);
});

test("a repeated rev counts as a gap", () => {
  const { client, resyncs } = make();
  client.receive({ type: "snapshot", rev: 0, tabs: [] });
  client.receive({ type: "patch", rev: 0, upserts: [row(1, 10, 0)], removed: [] });
  assert.deepEqual([resyncs.length, ids(client)], [1, []]);
});

test("the current and alternate marks show only in the line's window", () => {
  const { client } = make();
  client.receive({ type: "snapshot", rev: 0, tabs: [row(1, 10, 0, { active: true }), row(2, 10, 1, { previous: true }), row(3, 11, 0, { active: true }), row(4, 11, 1, { previous: true })] });
  assert.deepEqual(client.items()?.map((item) => [item.active, item.alternate]), [[true, undefined], [undefined, true], [undefined, undefined], [undefined, undefined]]);
});

test("one window lists only the line's window, and all windows list the line's window first, then by window and place", () => {
  const tabs = [row(1, 10, 0), row(2, 11, 1), row(3, 11, 0), row(4, 9, 0)];
  const one = make({ all_windows: false });
  one.client.receive({ type: "snapshot", rev: 0, tabs });
  assert.deepEqual(ids(one.client), [1]);
  const all = make({ line_window_id: 11 });
  all.client.receive({ type: "snapshot", rev: 0, tabs });
  assert.deepEqual(ids(all.client), [3, 2, 4, 1]);
});

test("a row carries the flags, the container and the window number as the list reads them", () => {
  const { client } = make();
  client.receive({
    type: "snapshot",
    rev: 0,
    tabs: [row(1, 10, 2, { pinned: true, audible: true, muted: true, discarded: true, favicon_url: "https://a.test/i.png", container_color: "blue", container_icon: "fingerprint", title: "two\n lines" })],
  });
  assert.deepEqual(client.items(), [
    {
      id: 1,
      number: 3,
      window_number: 1,
      title: "two lines",
      url: "https://site1.test/",
      favicon: "https://a.test/i.png",
      container: { color: "blue", icon: "fingerprint" },
      pinned: true,
      muted: true,
      discarded: true,
    },
  ]);
});

test("a patch that leaves the shown items unchanged does not report a change, and one that changes them does", () => {
  const { client, changes } = make({ all_windows: false });
  client.receive({ type: "snapshot", rev: 0, tabs: [row(1, 10, 0), row(2, 11, 0)] });
  assert.equal(changes(), 1);
  client.receive({ type: "patch", rev: 1, upserts: [row(2, 11, 0, { title: "Other window" })], removed: [] });
  assert.equal(changes(), 1);
  client.receive({ type: "patch", rev: 2, upserts: [row(1, 10, 0, { title: "Shown" })], removed: [] });
  assert.equal(changes(), 2);
  client.receive({ type: "patch", rev: 3, upserts: [row(1, 10, 0, { title: "Shown" })], removed: [] });
  assert.equal(changes(), 2);
});

test("a row with no title shows its address", () => {
  const { client } = make();
  client.receive({ type: "snapshot", rev: 0, tabs: [row(1, 10, 0, { title: "" })] });
  assert.equal(client.items()?.[0]?.title, "https://site1.test/");
});
