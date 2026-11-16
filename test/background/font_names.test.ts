import assert from "node:assert/strict";
import { test } from "node:test";
import { create_font_names } from "../../src/background/font_names.ts";
import { FONT_NAMES_STORAGE_KEY } from "../../src/background/storage_keys.ts";
import type { MeasureWidth } from "../../src/shared/font_candidates.ts";

const has_hack: MeasureWidth = (font) => (font.includes('"Hack"') ? 99 : 50);

function make(options: { host?: string[] | undefined; measure?: (() => MeasureWidth | undefined) | undefined; stored?: unknown } = {}) {
  const store: Record<string, unknown> = options.stored === undefined ? {} : { [FONT_NAMES_STORAGE_KEY]: options.stored };
  let host_calls = 0;
  const service = create_font_names({
    storage: {
      get: async (key) => (typeof key === "string" && key in store ? { [key]: structuredClone(store[key]) } : {}),
      set: async (values) => void Object.assign(store, structuredClone(values)),
    },
    host_fonts: async () => (host_calls++, options.host),
    measure: options.measure ?? (() => has_hack),
  });
  return { service, store, host_calls: () => host_calls };
}

test("a refresh merges the host's fonts with the probe and stores both", async () => {
  const { service, store } = make({ host: ["Cantarell", "Hack"] });
  assert.deepEqual(await service.refresh(), ["Cantarell", "Hack"]);
  assert.deepEqual(store[FONT_NAMES_STORAGE_KEY], { host: ["Cantarell", "Hack"], names: ["Cantarell", "Hack"] });
});

test("without the host the probe alone fills the list", async () => {
  const { service } = make({ host: undefined });
  assert.deepEqual(await service.refresh(), ["Hack"]);
});

test("a host that does not answer keeps the names it gave last time", async () => {
  const { service } = make({ host: undefined, stored: { host: ["Cantarell"], names: ["Cantarell"] } });
  assert.deepEqual(await service.refresh(), ["Cantarell", "Hack"]);
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
