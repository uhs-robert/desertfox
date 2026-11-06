import assert from "node:assert/strict";
import { test } from "node:test";
import { create_surface } from "../../src/content/surface.ts";

// Its own file: a surface module counts its first reads once per process.
test("a surface host stays hidden until both first reads return, and a failed read still shows it", async () => {
  const settle: Array<() => void> = [];
  Object.assign(globalThis, {
    browser: {
      storage: {
        local: { get: () => new Promise((resolve, reject) => settle.push(settle.length === 0 ? () => resolve({}) : () => reject(new Error("storage closed")))) },
        onChanged: { addListener: () => {} },
      },
    },
    document: { createElement: () => ({ textContent: "", style: {}, setAttribute: () => {}, attachShadow: () => ({ append: () => {} }), isConnected: true }) },
  });
  const host = create_surface("desertfox-a", "", 1).host;
  assert.equal(host.style.visibility, "hidden");
  settle[0]!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(host.style.visibility, "hidden");
  settle[1]!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(host.style.visibility, "");
});
