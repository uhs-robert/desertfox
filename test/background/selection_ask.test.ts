import assert from "node:assert/strict";
import { test } from "node:test";
import { ask_selection } from "../../src/background/selection_ask.ts";

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
