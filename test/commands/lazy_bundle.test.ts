import assert from "node:assert/strict";
import { test } from "node:test";
import { cmdline_open, help_whichkey, hint_run } from "../../src/content/handlers/lazy_bundle.ts";
import { bundles } from "../../src/content/bundles.ts";

test("a lazy bundle content command loads its bundle and refuses with the reason while the bundle registers nothing", async () => {
  const shown: string[] = [];
  const asked: string[] = [];
  bundles.connect({
    request_bundle: async (name) => {
      asked.push(name);
      return true;
    },
    on_idle: () => {},
    set_mode: () => {},
    show_error: (message) => shown.push(message),
    on_sink_missing: () => {},
  });
  const answer = hint_run.run({});
  assert.equal(bundles.is_loading(), true);
  assert.deepEqual(await answer, { ok: false, message: "needs hints" });
  assert.deepEqual(asked, ["hints"]);
  assert.deepEqual(shown, []);
  assert.equal(bundles.is_loading(), false);
});

test("the refusal names the missing bundle in words a user reads", async () => {
  const shown: string[] = [];
  bundles.connect({ request_bundle: async () => true, on_idle: () => {}, set_mode: () => {}, show_error: (message) => shown.push(message), on_sink_missing: () => {} });
  assert.deepEqual(await cmdline_open.run({}), { ok: false, message: "needs the command line" });
  assert.deepEqual(await help_whichkey.run({}), { ok: false, message: "needs the which-key panel" });
  assert.deepEqual(shown, []);
});
