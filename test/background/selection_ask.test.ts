import assert from "node:assert/strict";
import { test } from "node:test";
import { ask_selection, cleaned_module_selection } from "../../src/background/selection_ask.ts";

// A frame whose `page` bundle answers only once it is loaded, as content.js alone gives no answer.
function make_frame(selection: string, options: { loaded?: boolean; load_fails?: boolean; unreachable?: boolean } = {}) {
  let loaded = options.loaded ?? false;
  const calls: string[] = [];
  const deps = {
    ask: async () => {
      calls.push("ask");
      if (options.unreachable) throw new Error("no receiver");
      return loaded ? selection : undefined;
    },
    load_page_bundle: async () => {
      calls.push("load");
      if (options.load_fails) throw new Error("no access");
      loaded = true;
    },
  };
  return { deps, calls };
}

test("get_selection answers when the page bundle has not loaded yet: the bundle loads, then the ask runs again", async () => {
  const { deps, calls } = make_frame("chosen text");
  assert.equal(await ask_selection(deps, 1, 0), "chosen text");
  assert.deepEqual(calls, ["ask", "load", "ask"]);
});

test("a frame that has the page bundle answers the first ask, an empty selection included, with no load", async () => {
  const { deps, calls } = make_frame("", { loaded: true });
  assert.equal(await ask_selection(deps, 1, 0), "");
  assert.deepEqual(calls, ["ask"]);
});

test("a frame that cannot load the bundle or cannot be reached answers nothing", async () => {
  assert.equal(await ask_selection(make_frame("text", { load_fails: true }).deps, 1, 0), undefined);
  assert.equal(await ask_selection(make_frame("text", { unreachable: true }).deps, 1, 0), undefined);
});

test("a top frame that cannot answer is read through the module, when the module can read the tab", async () => {
  const asked: number[] = [];
  const deps = { ...make_frame("x", { unreachable: true }).deps, read_from_module: async (tab_id: number) => (asked.push(tab_id), "from the module") };
  assert.equal(await ask_selection(deps, 7, 0), "from the module");
  assert.deepEqual(asked, [7]);
});

test("the module is not asked when the frame answered, and not for a frame other than the top one", async () => {
  const asked: number[] = [];
  const read_from_module = async (tab_id: number) => (asked.push(tab_id), "from the module");
  assert.equal(await ask_selection({ ...make_frame("page text", { loaded: true }).deps, read_from_module }, 7, 0), "page text");
  assert.equal(await ask_selection({ ...make_frame("x", { unreachable: true }).deps, read_from_module }, 7, 3), undefined);
  assert.deepEqual(asked, []);
});

test("a module that fails or refuses leaves no selection", async () => {
  const deps = { ...make_frame("x", { unreachable: true }).deps, read_from_module: async () => Promise.reject(new Error("refused")) };
  assert.equal(await ask_selection(deps, 7, 0), undefined);
});

test("the module's text loses control and format characters and is cut at 1000 characters", () => {
  assert.equal(cleaned_module_selection("a\u0000b\nc\t\r\nd\u200De\u202Ef"), "ab c def");
  assert.equal(cleaned_module_selection("x".repeat(1500)).length, 1000);
  assert.equal([...cleaned_module_selection("\u{1F600}".repeat(1200))].length, 1000);
});

test("U+2028 and U+2029 become spaces like other line breaks", () => {
  assert.equal(cleaned_module_selection("first\u2028second\u2029third"), "first second third");
});
