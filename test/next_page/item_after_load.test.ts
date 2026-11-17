import assert from "node:assert/strict";
import { test } from "node:test";
import type { ItemCursor } from "../../src/content/item/pick.ts";
import { first_item_after, move_box_after_load } from "../../src/content/next_page/item_after_load.ts";
import type { ItemAfterLoadDeps } from "../../src/content/next_page/item_after_load.ts";
import { LOAD_WAIT_MS } from "../../src/content/next_page/load_outcome.ts";

// A page of items in document order. An item is on the page while it is in `items`, and a removed item compares as disconnected.
function fake_page(count: number) {
  const items: Element[] = [];
  const make = (name: string) => {
    const item = {
      name,
      get isConnected() {
        return items.includes(item as unknown as Element);
      },
      matches: () => true,
      querySelector: () => null,
      compareDocumentPosition: (other: Element) => {
        const [here, there] = [items.indexOf(item as unknown as Element), items.indexOf(other)];
        return here === -1 || there === -1 ? 1 : there > here ? 4 : 2;
      },
    };
    return item as unknown as Element;
  };
  items.push(...Array.from({ length: count }, (_, at) => make(`old${at}`)));
  let on_added = (_added: readonly Element[]) => {};
  // An element that holds no item, as a spinner or an ad.
  const spinner = { matches: () => false, querySelector: () => null } as unknown as Element;
  const page = {
    items,
    // Appends new items and fires the page's watch, as a load does. With no names it adds a spinner.
    add: (...names: string[]) => {
      const added = names.map(make);
      items.push(...added);
      on_added(added.length > 0 ? added : [spinner]);
    },
    // Items the browser hides, as one that fades in from opacity 0.
    hidden: new Set<string>(),
    reads: 0,
    remove: (...names: string[]) => names.forEach((name) => items.splice(items.findIndex((item) => (item as unknown as { name: string }).name === name), 1)),
    named: (name: string) => items.find((item) => (item as unknown as { name: string }).name === name)!,
    landed: [] as string[],
    mode: "normal",
    // The item the last j or k moved to, as the item bundle holds it.
    current: undefined as Element | undefined,
    shown: true,
  };
  const cursor = (): ItemCursor | undefined => page.current && { item_: page.current, selector_: "li", shown_: page.shown, land_: (item) => void page.landed.push((item as unknown as { name: string }).name) };
  const deps: ItemAfterLoadDeps = {
    items_: () => (page.reads++, items.filter((item) => !page.hidden.has((item as unknown as { name: string }).name))),
    watch_: { start_: (added) => ((on_added = added), () => (on_added = () => {})), page_height_: () => 0 },
    cursor_: () => Promise.resolve(cursor()),
    in_normal_mode_: () => page.mode === "normal",
  };
  return { page, deps, cursor };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the first item after the old last one is new, even when the page dropped the items above", () => {
  const { page } = fake_page(5);
  const old_items = [...page.items];
  page.remove("old0", "old1", "old2");
  page.add("new0", "new1");
  assert.equal(first_item_after(old_items, page.items), page.named("new0"));
});

test("with the old last item gone, the first item after the last old one still on the page is new", () => {
  const { page } = fake_page(3);
  const old_items = [...page.items];
  page.remove("old2");
  page.add("new0");
  assert.equal(first_item_after(old_items, page.items), page.named("new0"));
  page.remove("old0", "old1");
  assert.equal(first_item_after(old_items, page.items), undefined);
});

test("the box moves to the first new item once a load adds it, from any item it was on", async () => {
  const { page, deps, cursor } = fake_page(5);
  page.current = page.named("old1");
  const done = move_box_after_load(cursor(), deps);
  page.add("new0", "new1");
  await done;
  assert.deepEqual(page.landed, ["new0"]);
});

test("the box moves on when the page virtualized the item it was on before the load landed", async () => {
  const { page, deps, cursor } = fake_page(5);
  page.current = page.named("old4");
  const done = move_box_after_load(cursor(), deps);
  page.remove("old0", "old3", "old4");
  page.add("new0");
  await done;
  assert.deepEqual(page.landed, ["new0"]);
});

test("an addition that brings no item (a spinner) waits on, and the item after it takes the box", async () => {
  const { page, deps, cursor } = fake_page(3);
  page.current = page.named("old0");
  const done = move_box_after_load(cursor(), deps);
  page.add();
  await settle();
  assert.deepEqual(page.landed, []);
  page.add("new0");
  await done;
  assert.deepEqual(page.landed, ["new0"]);
});

test("with no item row active, nothing moves", async () => {
  const { page, deps, cursor } = fake_page(3);
  const read: string[] = [];
  const counted = { ...deps, items_: (selector: string) => (read.push(selector), deps.items_(selector)) };
  await move_box_after_load(cursor(), counted);
  page.current = page.named("old0");
  page.shown = false;
  await move_box_after_load(cursor(), counted);
  assert.deepEqual(read, [], "the page was read without a box on an item");
  assert.deepEqual(page.landed, []);
});

test("a box the user moved to another item during the wait stays there", async () => {
  const { page, deps, cursor } = fake_page(3);
  page.current = page.named("old2");
  const done = move_box_after_load(cursor(), deps);
  page.current = page.named("old1");
  page.add("new0");
  await done;
  assert.deepEqual(page.landed, []);
});

test("a mode the user entered during the wait keeps the focus where it is", async () => {
  const { page, deps, cursor } = fake_page(3);
  page.current = page.named("old2");
  const done = move_box_after_load(cursor(), deps);
  page.mode = "cmdline";
  page.add("new0");
  await done;
  assert.deepEqual(page.landed, []);
});

test("a load that adds no item leaves the box at the end of the wait", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { page, deps, cursor } = fake_page(3);
  page.current = page.named("old2");
  const done = move_box_after_load(cursor(), deps);
  page.add();
  t.mock.timers.tick(LOAD_WAIT_MS);
  await done;
  assert.deepEqual(page.landed, []);
});

test("an addition that holds no item does not read the item list", async () => {
  const { page, deps, cursor } = fake_page(3);
  page.current = page.named("old0");
  const done = move_box_after_load(cursor(), deps);
  const reads_at_start = page.reads;
  page.add();
  page.add();
  await settle();
  assert.equal(page.reads, reads_at_start, "a batch with no item read the list");
  page.add("new0");
  await done;
  assert.deepEqual(page.landed, ["new0"]);
});

test("an item that fades in after its batch takes the box at the end of the wait", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { page, deps, cursor } = fake_page(3);
  page.current = page.named("old2");
  const done = move_box_after_load(cursor(), deps);
  page.hidden.add("new0");
  page.add("new0");
  await settle();
  page.hidden.delete("new0");
  t.mock.timers.tick(LOAD_WAIT_MS);
  await done;
  assert.deepEqual(page.landed, ["new0"]);
});
