import assert from "node:assert/strict";
import { test } from "node:test";
import { reinject_missing_content_scripts } from "../../src/background/reload.ts";

test("pinged tabs are left alone, silent tabs get the script, other schemes are skipped", async () => {
  const injected: number[] = [];
  const report = await reinject_missing_content_scripts(
    {
      list_tabs: async () => [
        { tab_id: 1, url: "https://a.example/" },
        { tab_id: 2, url: "https://b.example/" },
        { tab_id: 3, url: "about:config" },
        { tab_id: 4, url: "https://addons.mozilla.org/" },
      ],
      ping: async (id) => id === 1,
      inject: async (id) => {
        if (id === 4) throw new Error("restricted");
        injected.push(id);
      },
    },
    5,
  );
  assert.deepEqual(report, { at: 5, already_loaded: 1, injected: 1, failed: 1 });
  assert.deepEqual(injected, [2]);
});
