import assert from "node:assert/strict";
import { test } from "node:test";
import { create_font_names } from "../../src/background/font_names.ts";
import { FONT_NAMES_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import type { MeasureWidth } from "../../src/shared/font_candidates.ts";

const has_hack: MeasureWidth = (font) => (font.includes('"Hack"') ? 99 : 50);

function make(options: { host?: string[] | undefined; host_error?: Error; measure?: (() => MeasureWidth | undefined) | undefined; stored?: unknown } = {}) {
  const store: Record<string, unknown> = options.stored === undefined ? {} : { [FONT_NAMES_STORAGE_KEY]: options.stored };
  let host_calls = 0;
  const service = create_font_names({
    storage: {
      get: async (key) => (typeof key === "string" && key in store ? { [key]: structuredClone(store[key]) } : {}),
      set: async (values) => void Object.assign(store, structuredClone(values)),
    },
    host_fonts: async () => {
      host_calls++;
      if (options.host_error) throw options.host_error;
      return options.host;
    },
    measure: options.measure ?? (() => has_hack),
  });
  return { service, store, host_calls: () => host_calls };
}

test("a host answer stands alone, with no probe names added", async () => {
  const { service, store } = make({ host: ["Cantarell"] });
  assert.deepEqual(await service.refresh(), ["Cantarell"]);
  assert.deepEqual(store[FONT_NAMES_STORAGE_KEY], { host: ["Cantarell"], names: ["Cantarell"] });
});

test("without the host the probe alone fills the list", async () => {
  const { service } = make({ host: undefined });
  assert.deepEqual(await service.refresh(), ["Hack"]);
});

test("a read on an empty cache that starts before a refresh cannot overwrite the host's list", async () => {
  const { service, store } = make({ host: ["Cantarell"] });
  const [, refreshed] = await Promise.all([service.read(), service.refresh()]);
  assert.deepEqual(refreshed, ["Cantarell"]);
  assert.deepEqual((store[FONT_NAMES_STORAGE_KEY] as { names: string[] }).names, ["Cantarell"]);
});

test("a read does not wait on a slow host", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const store: Record<string, unknown> = {};
  const service = create_font_names({
    storage: { get: async (key) => (typeof key === "string" && key in store ? { [key]: store[key] } : {}), set: async (values) => void Object.assign(store, values) },
    host_fonts: async () => (await gate, ["Cantarell"]),
    measure: () => has_hack,
  });
  const refreshing = service.refresh();
  assert.deepEqual(await service.read(), ["Hack"]);
  release();
  assert.deepEqual(await refreshing, ["Cantarell"]);
});

test("read answers from the cache and never asks the host", async () => {
  const { service, host_calls } = make({ host: ["X"], stored: { host: [], names: ["Cached Font"] } });
  assert.deepEqual(await service.read(), ["Cached Font"]);
  assert.equal(host_calls(), 0);
});

test("read with no cache probes once, stores the result and skips the host", async () => {
  const { service, store, host_calls } = make({ host: ["X"] });
  assert.deepEqual(await service.read(), ["Hack"]);
  assert.deepEqual(store[FONT_NAMES_STORAGE_KEY], { host: [], names: ["Hack"] });
  assert.equal(host_calls(), 0);
});

test("a malformed cache reads as absent", async () => {
  for (const stored of ["text", { host: "x", names: [] }, { host: [], names: [1] }, null]) {
    const { service } = make({ stored });
    assert.deepEqual(await service.read(), ["Hack"], JSON.stringify(stored));
  }
});

test("with no canvas the list is the host's alone", async () => {
  const { service } = make({ host: ["Cantarell"], measure: () => undefined });
  assert.deepEqual(await service.refresh(), ["Cantarell"]);
});

test("a failed host call keeps the cached host list", async () => {
  const { service, store } = make({ host_error: new Error("timeout"), stored: { host: ["Cantarell"], names: ["Cantarell"] } });
  assert.deepEqual(await service.refresh(), ["Cantarell"]);
  assert.deepEqual(store[FONT_NAMES_STORAGE_KEY], { host: ["Cantarell"], names: ["Cantarell"] });
});

test("a failed host call with no cached host list gives the probe list", async () => {
  const { service } = make({ host_error: new Error("timeout"), stored: { host: [], names: ["Old"] } });
  assert.deepEqual(await service.refresh(), ["Hack"]);
});

test("a missing host replaces a cached host list with the probe list", async () => {
  const { service } = make({ host: undefined, stored: { host: ["Cantarell"], names: ["Cantarell"] } });
  assert.deepEqual(await service.refresh(), ["Hack"]);
});

test("of two overlapping refreshes only the newest writes", async () => {
  const releases: (() => void)[] = [];
  const answers = [["Stale"], ["Fresh"]];
  const store: Record<string, unknown> = {};
  let call = 0;
  const service = create_font_names({
    storage: { get: async (key) => (typeof key === "string" && key in store ? { [key]: store[key] } : {}), set: async (values) => void Object.assign(store, values) },
    host_fonts: () => {
      const mine = call++;
      return new Promise((resolve) => releases.push(() => resolve(answers[mine]!)));
    },
    measure: () => has_hack,
  });
  const first = service.refresh();
  const second = service.refresh();
  releases[1]!();
  await second;
  releases[0]!();
  await first;
  assert.deepEqual((store[FONT_NAMES_STORAGE_KEY] as { names: string[] }).names, ["Fresh"]);
});
