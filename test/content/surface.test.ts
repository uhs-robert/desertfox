import assert from "node:assert/strict";
import { test } from "node:test";
import { create_surface, mount_surface } from "../../src/content/surface.ts";

function fake_host() {
  const calls: string[] = [];
  let open = false;
  return {
    calls,
    host: {
      matches: () => open,
      hidePopover: () => ((open = false), calls.push("hide")),
      showPopover: () => ((open = true), calls.push("show")),
    } as unknown as HTMLElement,
  };
}

test("mount_surface attaches the host, then shows it as a popover", () => {
  const { host, calls } = fake_host();
  const root = { append: () => calls.push("append") };
  Object.assign(globalThis, { document: { documentElement: root } });
  mount_surface(host);
  assert.deepEqual(calls, ["append", "show"]);
});

test("mount_surface hides an open host first so it moves above a newer modal", () => {
  const { host, calls } = fake_host();
  Object.assign(globalThis, { document: { documentElement: { append: () => calls.push("append") } } });
  mount_surface(host);
  calls.length = 0;
  mount_surface(host);
  assert.deepEqual(calls, ["append", "hide", "show"]);
});

test("create_surface makes a manual popover host", () => {
  const attributes: Record<string, string> = {};
  const host = {
    style: {},
    setAttribute: (name: string, value: string) => (attributes[name] = value),
    attachShadow: () => ({ append: () => {} }),
  };
  Object.assign(globalThis, {
    document: { createElement: (tag: string) => (tag === "div" ? host : { style: {} }) },
  });
  create_surface("x", "", 1);
  assert.equal(attributes.popover, "manual");
});
