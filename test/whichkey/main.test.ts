import assert from "node:assert/strict";
import { test } from "node:test";
import type { BundleHandler } from "../../src/content/bundle_host.ts";

test("help.whichkey asks for the keys of the mode the host reports", async () => {
  const handlers = new Map<string, BundleHandler>();
  const asked: unknown[] = [];
  let mode = "caret";
  Object.assign(globalThis, {
    window: { desertfox_host: { register_handler: (id: string, run: BundleHandler) => handlers.set(id, run), get_mode: () => mode } },
    browser: { runtime: { sendMessage: (message: unknown) => (asked.push(message), new Promise(() => {})) } },
  });
  await import("../../src/content/whichkey/main.ts");
  handlers.get("help.whichkey")!({});
  mode = "visual";
  handlers.get("help.whichkey")!({});
  assert.deepEqual(asked, [
    { type: "list_keys", mode: "caret", prefix: [] },
    { type: "list_keys", mode: "visual", prefix: [] },
  ]);
});
