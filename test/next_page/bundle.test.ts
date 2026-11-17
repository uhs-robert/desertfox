import assert from "node:assert/strict";
import { test } from "node:test";

test("the next_page bundle registers page.follow, and registers once", async () => {
  const registered: string[] = [];
  const host = { register_handler_: (id: string) => void registered.push(id) };
  (globalThis as Record<string, unknown>).window = { desertfox_host: host };
  const bundle_url = new URL("../../src/content/next_page/main.ts", import.meta.url).href;
  await import(`${bundle_url}?first`);
  await import(`${bundle_url}?second`);
  assert.deepEqual(registered, ["page.follow"]);
});
