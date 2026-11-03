import assert from "node:assert/strict";
import { test } from "node:test";
import { NEEDS_COMMAND_LINE, NEEDS_HINTS, hint_run } from "../../src/content/handlers/lazy_bundle.ts";
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
  assert.deepEqual(shown, [NEEDS_HINTS]);
  assert.equal(bundles.is_loading(), false);
  assert.match(NEEDS_COMMAND_LINE, /command line/);
});
