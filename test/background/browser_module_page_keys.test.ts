import assert from "node:assert/strict";
import { test } from "node:test";
import { create_register_read, create_run_without_page, read_module_headings } from "../../src/background/browser_module_page_keys.ts";
import type { ModuleArgs } from "../../src/shared/browser_module_protocol.ts";
import { REGISTER_TEXT_CHARS } from "../../src/shared/browser_module_protocol.ts";
import type { CallResult } from "../../src/background/browser_module_call.ts";

const ROWS = JSON.stringify([[1, "Intro"], [2, "Install"], [2, "Usage"]]);

// A module that answers the two heading kinds, and the calls it saw.
function module_stub({ rows = ROWS as string | null, go = { ok: true } as CallResult } = {}) {
  const calls: { kind: string; args: ModuleArgs }[] = [];
  const call = async (kind: string, args: ModuleArgs): Promise<CallResult> => {
    calls.push({ kind, args });
    if (kind === "page_headings.read") return rows === null ? { ok: false, error: "Needs the browser module" } : { ok: true, value: rows };
    return go;
  };
  return { call, calls };
}

test("the heading list is the module's rows, and nothing when the module refuses", async () => {
  assert.deepEqual(await read_module_headings(module_stub().call, 4), [{ level: 1, text: "Intro" }, { level: 2, text: "Install" }, { level: 2, text: "Usage" }]);
  assert.equal(await read_module_headings(module_stub({ rows: null }).call, 4), undefined);
  assert.equal(await read_module_headings(module_stub({ rows: "not json" }).call, 4), undefined);
});

test("heading.go on a tab with no page picks the index here and asks the module to scroll to it", async () => {
  const stub = module_stub();
  const run = create_run_without_page(stub.call);
  assert.deepEqual(await run("heading.go", { heading: "2 Install" }, 4), { ok: true });
  assert.deepEqual(await run("heading.go", { heading: "usage" }, 4), { ok: true });
  assert.deepEqual(stub.calls.filter((each) => each.kind === "page_heading.go").map((each) => each.args), [{ tab_id: 4, index: 1 }, { tab_id: 4, index: 2 }]);
  assert.deepEqual(await run("heading.go", { heading: "zzzz" }, 4), { ok: false, message: "No heading matches zzzz" });
  assert.equal(stub.calls.filter((each) => each.kind === "page_heading.go").length, 2, "a pick that matches nothing asks the module nothing");
});

test("heading.go says why when the module cannot list or scroll, and every other command is left alone", async () => {
  assert.deepEqual(await create_run_without_page(module_stub({ rows: null }).call)("heading.go", { heading: "Intro" }, 4), { ok: false, message: "The headings of this page cannot be read" });
  assert.deepEqual(await create_run_without_page(module_stub({ go: { ok: false, error: "That heading is gone" } }).call)("heading.go", { heading: "Intro" }, 4), { ok: false, message: "That heading is gone" });
  const stub = module_stub();
  assert.equal(await create_run_without_page(stub.call)("scroll.align", { position: "top" }, 4), undefined);
  assert.equal(await create_run_without_page(stub.call)("heading.go", {}, 4), undefined);
  assert.deepEqual(stub.calls, []);
});

function register_stub(values: Record<string, unknown>, privacy = false) {
  const reads: { name: string; is_private: boolean }[] = [];
  const handler = create_register_read({
    store: { read: async (name, is_private) => (reads.push({ name, is_private }), values[name] as never) },
    is_private: async (tab_id) => (tab_id === 99 ? undefined : privacy),
  });
  return { handler, reads };
}

test("register.read returns the text of a register for the asking tab's privacy, cleaned and capped", async () => {
  const { handler, reads } = register_stub({ a: "line one\nline\ttwo\u0000​", b: "x".repeat(REGISTER_TEXT_CHARS + 500), "+": "from the clipboard" }, true);
  assert.equal(await handler({ tab_id: 1, name: "a" }), "line one\nline\ttwo");
  assert.equal([...(await handler({ tab_id: 1, name: "b" }))].length, REGISTER_TEXT_CHARS);
  assert.equal(await handler({ tab_id: 1, name: "+" }), "from the clipboard");
  assert.deepEqual(reads.map((read) => read.is_private), [true, true, true], "the tab says private, not the request");
});

test("register.read refuses a bad name, a macro, an empty or unset register and a tab that is gone", async () => {
  const { handler, reads } = register_stub({ a: [{ id: "tab.next" }], b: "", c: undefined });
  for (const name of ["", "ab", "1", "<Esc>", "a ", "/:direction", "é"]) await assert.rejects(handler({ tab_id: 1, name }), /not a register name/, JSON.stringify(name));
  for (const name of ["a", "b", "c"]) await assert.rejects(handler({ tab_id: 1, name }), /no text/, name);
  await assert.rejects(handler({ tab_id: 99, name: "a" }), /tab is gone/);
  assert.equal(reads.length, 3, "a bad name or a gone tab reads no register");
});
