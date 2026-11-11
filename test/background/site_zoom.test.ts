import assert from "node:assert/strict";
import { test } from "node:test";
import { create_site_zoom, make_level_for, zoom_site_of } from "../../src/background/site_zoom.ts";
import { compile_keymap } from "../../src/shared/keys/index.ts";
import { COMPILED_KEYMAP_STORAGE_KEY } from "../../src/shared/prefix_tree.ts";
import type { Settings } from "../../src/shared/settings_table.ts";
import { SETTING_SPECS } from "../../src/shared/settings_schema.ts";

function make_session() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key: string) => (data.has(key) ? { [key]: structuredClone(data.get(key)) } : {}),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => data.set(key, structuredClone(value))),
    remove: async (key: string) => void data.delete(key),
  };
}

// A fake browser: the tabs' addresses, the levels the setting gives and every setZoom call. `session` is shared, so a second instance stands for a restarted background.
function make({ levels = { "a.test": 1.5 } as Record<string, number>, session = make_session() } = {}) {
  const addresses = new Map<number, string>();
  const calls: [number, number][] = [];
  let fail_next_set = false;
  const deps = {
    session: session as never,
    level_for: async (address: string) => levels[new URL(address).hostname],
    address_of: async (tab_id: number) => addresses.get(tab_id),
    set_zoom: async (tab_id: number, level: number) => {
      if (fail_next_set) {
        fail_next_set = false;
        throw new Error("Invalid tab");
      }
      calls.push([tab_id, level]);
    },
  };
  const zoom = create_site_zoom(deps);
  const go = (tab_id: number, address: string) => {
    addresses.set(tab_id, address);
    return zoom.navigated(tab_id, address);
  };
  return { zoom, go, calls, levels, session, addresses, fail_set: () => void (fail_next_set = true), restart: () => create_site_zoom(deps) };
}

test("the zoom memory key is the host: ports share it, subdomains do not", () => {
  assert.equal(zoom_site_of("http://127.0.0.1:8000/a"), zoom_site_of("http://127.0.0.1:9000/b"));
  assert.notEqual(zoom_site_of("https://a.example.test/"), zoom_site_of("https://b.example.test/"));
  assert.equal(zoom_site_of("file:///home/a.html"), "file:");
  assert.equal(zoom_site_of("not a url"), undefined);
});

test("one load that fires several updates sets the zoom once", async () => {
  const { zoom, addresses, calls } = make();
  addresses.set(1, "https://a.test/");
  await Promise.all([zoom.navigated(1, "https://a.test/"), zoom.navigated(1, "https://a.test/"), zoom.navigated(1, "https://a.test/")]);
  assert.deepEqual(calls, [[1, 1.5]]);
});

test("a reload or another page of the same site keeps a manual zoom", async () => {
  const { go, calls } = make();
  await go(1, "https://a.test/one");
  await go(1, "https://a.test/one");
  await go(1, "https://a.test/two?q=1");
  assert.deepEqual(calls, [[1, 1.5]]);
});

test("a tab that moves to another site and back keeps the zoom it had there", async () => {
  const { go, calls, levels } = make();
  levels["b.test"] = 2;
  await go(1, "https://a.test/");
  await go(1, "https://b.test/");
  await go(1, "https://a.test/");
  await go(1, "https://b.test/");
  assert.deepEqual(calls, [[1, 1.5], [1, 2]]);
});

test("each tab sets the level once", async () => {
  const { go, calls } = make();
  await go(1, "https://a.test/");
  await go(2, "https://a.test/");
  await go(1, "https://a.test/");
  assert.deepEqual(calls, [[1, 1.5], [2, 1.5]]);
});

test("a level that changed since the tab set it is set again", async () => {
  const { go, calls, levels } = make();
  await go(1, "https://a.test/");
  levels["a.test"] = 2;
  await go(1, "https://a.test/next");
  assert.deepEqual(calls, [[1, 1.5], [1, 2]]);
});

test("a site with no level leaves the zoom alone, and a level added later applies on the next load", async () => {
  const { go, calls, levels, session } = make({ levels: {} });
  await go(1, "https://a.test/");
  assert.deepEqual(calls, []);
  assert.equal(session.data.size, 0);
  levels["a.test"] = 1.2;
  await go(1, "https://a.test/");
  assert.deepEqual(calls, [[1, 1.2]]);
});

test("a closed tab forgets its sites, so a reused id sets the zoom again", async () => {
  const { zoom, go, calls, session } = make();
  await go(1, "https://a.test/");
  await zoom.closed(1);
  assert.equal(session.data.size, 0);
  await go(1, "https://a.test/");
  assert.deepEqual(calls, [[1, 1.5], [1, 1.5]]);
});

test("a restarted background reads what the tabs already set from storage.session", async () => {
  const { go, calls, restart, addresses } = make();
  await go(1, "https://a.test/");
  const again = restart();
  await again.navigated(1, addresses.get(1)!);
  assert.deepEqual(calls, [[1, 1.5]]);
});

test("a tab that left the site before the level was read is not zoomed, so the other site's memory stays", async () => {
  const { zoom, addresses, calls, session } = make();
  addresses.set(1, "https://b.test/");
  await zoom.navigated(1, "https://a.test/");
  assert.deepEqual(calls, []);
  assert.equal(session.data.size, 0);
});

test("a closed tab is not zoomed", async () => {
  const { zoom, calls } = make();
  await zoom.navigated(7, "https://a.test/");
  assert.deepEqual(calls, []);
});

test("a failed setZoom records nothing, so the next load tries again", async () => {
  const { go, calls, fail_set } = make();
  fail_set();
  await go(1, "https://a.test/");
  await go(1, "https://a.test/");
  assert.deepEqual(calls, [[1, 1.5]]);
});

const resolve = () => ({ runs_in: "content" as const, label: "x", count: "ignore" as const });
const local_of = (site_rules: Settings["site_rules"]) => {
  const { compiled } = compile_keymap({}, { site_rules }, resolve);
  return { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: compiled }) } as never;
};

test("a site row's zoom beats the global level, and the first row that sets zoom decides it", async () => {
  const local = local_of([
    { site: "https://a.test/*", pass: "j" },
    { site: "https://a.test/*", zoom: 1.5 },
    { site: "https://*/*", zoom: 0.8 },
  ]);
  const level_for = make_level_for(local, async () => 1.2, async () => false);
  assert.equal(await level_for("https://a.test/x"), 1.5);
  assert.equal(await level_for("https://b.test/"), 0.8);
  assert.equal(await level_for("http://c.test/"), 1.2);
});

test("with no global level a page off the table keeps its zoom", async () => {
  const level_for = make_level_for(local_of([{ site: "https://a.test/*", zoom: 2 }]), async () => undefined, async () => false);
  assert.equal(await level_for("https://b.test/"), undefined);
});

test("the switch off leaves every zoom alone", async () => {
  const level_for = make_level_for(local_of([{ site: "https://a.test/*", zoom: 2 }]), async () => 1.2, async () => true);
  assert.equal(await level_for("https://a.test/"), undefined);
});

test("the zoom check takes Firefox's range only, in a site row too", () => {
  const { check } = SETTING_SPECS.zoom;
  for (const good of [0.3, 1, 1.25, 5]) assert.equal(check(good), true, String(good));
  for (const bad of [0.2, 5.1, "1.5", Number.NaN]) assert.equal(check(bad), false, String(bad));
  assert.equal(SETTING_SPECS.site_rules.check([{ site: "https://a.test/*", zoom: 1.5 }]), true);
  assert.match(SETTING_SPECS.site_rules.explain!([{ site: "https://a.test/*", zoom: 9 }])!, /"zoom" that is not a number, from 0.3 to 5/);
});
