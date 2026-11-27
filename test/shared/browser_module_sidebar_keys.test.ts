import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_MODULE_PROTOCOL_VERSION as V, MAX_KEY_ROWS, SIDEBAR_COMMAND_IDS, sidebar_keys_of, validate_module_state } from "../../src/shared/browser_module_protocol.ts";

const state = (patch: Record<string, unknown> = {}) => ({ v: V, enabled: true, keys: [{ key: "J", id: "tab.next", args: {} }], tabs: {}, ...patch });
const ROWS = [
  { keys: ["j"], id: "sidebar.down" },
  { keys: ["g", "g"], id: "sidebar.first" },
  { keys: ["<Escape>"], id: "sidebar.leave" },
];

test("the sidebar table is kept with one- and two-token rows, and unknown row fields are dropped", () => {
  const checked = validate_module_state(state({ sidebar_keys: ROWS.map((row) => ({ ...row, label: "new field" })) }));
  assert.ok(checked.ok);
  assert.deepEqual(checked.value.sidebar_keys, ROWS);
  const absent = validate_module_state(state());
  assert.ok(absent.ok && !("sidebar_keys" in absent.value));
});

test("a bad sidebar table is left out whole and never fails the state, so the tab keys stay", () => {
  const too_many = Array.from({ length: MAX_KEY_ROWS + 1 }, (_, index) => ({ keys: [`<F${index + 1}>`], id: "sidebar.down" }));
  const junk: unknown[] = [
    "j",
    { j: "sidebar.down" },
    too_many,
    [null],
    [{ keys: ["j"], id: "tab.next" }],
    [{ keys: ["j"], id: "sidebar.nope" }],
    [{ keys: "j", id: "sidebar.down" }],
    [{ keys: [], id: "sidebar.down" }],
    [{ keys: ["g", "g", "g"], id: "sidebar.first" }],
    [{ keys: ["two words"], id: "sidebar.down" }],
    [{ keys: ["x".repeat(25)], id: "sidebar.down" }],
    [{ keys: ["\u0007"], id: "sidebar.down" }],
    [{ keys: ["j"], id: "sidebar.down" }, { keys: ["j"], id: "sidebar.up" }],
    [{ keys: ["g"], id: "sidebar.last" }, { keys: ["g", "g"], id: "sidebar.first" }],
    [{ keys: ["g", "g"], id: "sidebar.first" }, { keys: ["g"], id: "sidebar.last" }],
  ];
  for (const sidebar_keys of junk) {
    assert.equal(sidebar_keys_of(sidebar_keys), undefined, JSON.stringify(sidebar_keys));
    const checked = validate_module_state(state({ sidebar_keys }));
    assert.ok(checked.ok && checked.value.keys.length === 1 && !("sidebar_keys" in checked.value), JSON.stringify(sidebar_keys));
  }
});

test("every sidebar command id is under the sidebar prefix and none repeats", () => {
  assert.equal(new Set(SIDEBAR_COMMAND_IDS).size, SIDEBAR_COMMAND_IDS.length);
  for (const id of SIDEBAR_COMMAND_IDS) assert.match(id, /^sidebar\.[a-z_]+$/);
});
