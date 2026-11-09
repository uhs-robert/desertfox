import assert from "node:assert/strict";
import { test } from "node:test";

test("running the ui bundle twice registers its handlers once, so no surface is orphaned", async () => {
  const registered: string[] = [];
  const host = { register_sink_: () => {}, register_handler_: (id: string) => void registered.push(id) };
  (globalThis as Record<string, unknown>).window = { desertfox_host: host };
  // A query string makes Node evaluate the module again, as a second injection does.
  const bundle_url = new URL("../../src/content/ui/main.ts", import.meta.url).href;
  await import(`${bundle_url}?first`);
  await import(`${bundle_url}?second`);
  assert.deepEqual(registered, ["ui.toast", "ui.badge"]);
});
