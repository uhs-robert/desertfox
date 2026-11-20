import assert from "node:assert/strict";
import { test } from "node:test";
import { checkbox_in } from "../src/content/item_act/checkbox.ts";

// An item of fake elements. A selector matches the elements whose `kind` it names, and `shown` stands for the visibility rule.
type Fake = { name: string; kind: string; shown: boolean };
const shown_box = (name: string, kind: string): Fake => ({ name, kind, shown: true });
const item_of = (elements: Fake[]) =>
  ({
    querySelectorAll: (selector: string) =>
      elements
        .filter((element) => selector.includes(element.kind))
        .map((element) => ({ name: element.name, checkVisibility: () => element.shown, getClientRects: () => (element.shown ? [{}] : []) })),
  }) as unknown as Element;
const name_of = (element: Element | undefined) => (element as unknown as { name: string } | undefined)?.name;

test("a shown native checkbox comes before a role checkbox, even one earlier in the item", () => {
  const item = item_of([shown_box("aria", 'role="checkbox"'), shown_box("native", 'type="checkbox"')]);
  assert.equal(name_of(checkbox_in(item)), "native");
});

test("with no native checkbox the first shown role checkbox is taken", () => {
  const item = item_of([{ name: "hidden aria", kind: 'role="checkbox"', shown: false }, shown_box("aria", 'role="checkbox"')]);
  assert.equal(name_of(checkbox_in(item)), "aria");
});

test("a hidden native checkbox is skipped, and an item with none shown has no checkbox", () => {
  const item = item_of([{ name: "hidden", kind: 'type="checkbox"', shown: false }]);
  assert.equal(checkbox_in(item), undefined);
});

test("a target selector replaces the search", () => {
  const item = item_of([shown_box("native", 'type="checkbox"'), shown_box("star", ".star")]);
  assert.equal(name_of(checkbox_in(item, ".star")), "star");
  assert.equal(checkbox_in(item, ".missing"), undefined);
});

test("the item_act bundle registers page.item_action, and registers once", async () => {
  const registered: string[] = [];
  (globalThis as Record<string, unknown>).window = { desertfox_host: { register_handler_: (id: string) => void registered.push(id) } };
  const bundle_url = new URL("../src/content/item_act/main.ts", import.meta.url).href;
  await import(`${bundle_url}?first`);
  await import(`${bundle_url}?second`);
  assert.deepEqual(registered, ["page.item_action"]);
});

test("target goes with toggle only, and the action is required", async () => {
  await import("../src/background/command_modules.ts");
  const { registry } = await import("../src/shared/registry/builtin.ts");
  const { check_args } = await import("../src/shared/registry/index.ts");
  const command = registry.get("page.item_action")!;
  assert.equal(check_args(command, { action: "toggle", target: ".star" }).ok, true);
  assert.equal(check_args(command, { action: "open", target: ".star" }).ok, false);
  assert.equal(check_args(command, { action: "open" }).ok, true);
  assert.equal(check_args(command, {}).ok, false);
});
