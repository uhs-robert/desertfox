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
  hint_run.run({});
  assert.equal(bundles.is_loading(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(asked, ["hints"]);
  assert.deepEqual(shown, ["needs hints"]);
  assert.equal(bundles.is_loading(), false);
});

test("the refusal names the missing bundle in words a user reads", async () => {
  const shown: string[] = [];
  bundles.connect({ request_bundle: async () => true, on_idle: () => {}, set_mode: () => {}, show_error: (message) => shown.push(message), on_sink_missing: () => {} });
  cmdline_open.run({});
  await new Promise((resolve) => setImmediate(resolve));
  help_whichkey.run({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(shown, ["needs the command line", "needs the which-key panel"]);
});
