import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { browser_module_call } from "../../src/background/browser_module_call.ts";
import { BROWSER_MODULE_HELLO_STORAGE_KEY, BROWSER_MODULE_PROTOCOL_VERSION } from "../../src/shared/browser_module_protocol.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const ctx: CommandContext = { tab_id: 1, window_id: 1, frame_id: 0, mode: "normal" };

// Runs pane.move with `hello` in the session store and gives back the module calls it made and its refusal, if any.
async function move_with_hello(hello: unknown): Promise<{ sent: string[]; refusal?: string }> {
  const globals = globalThis as { browser?: unknown };
  const saved_browser = globals.browser;
  const saved_call = browser_module_call.call;
  const sent: string[] = [];
  globals.browser = { storage: { session: { get: async (key: string) => (key === BROWSER_MODULE_HELLO_STORAGE_KEY && hello !== undefined ? { [key]: hello } : {}) } } };
  browser_module_call.call = async (kind, args) => (sent.push(`${kind} ${JSON.stringify(args)}`), hello === undefined ? { ok: false, error: "Needs the browser module" } : { ok: true });
  try {
    await registry.get("pane.move")!.run!(ctx, { direction: "left" });
    return { sent };
  } catch (error) {
    assert.ok(error instanceof RuntimeRefusal, String(error));
    return { sent, refusal: error.message };
  } finally {
    globals.browser = saved_browser;
    browser_module_call.call = saved_call;
  }
}

const HELLO = { v: BROWSER_MODULE_PROTOCOL_VERSION, module_version: "1.0.0" };

test("pane.move sends the direction to a module whose hello says pane_moves", async () => {
  assert.deepEqual(await move_with_hello({ ...HELLO, pane_moves: true }), { sent: ['pane.move {"direction":"left"}'] });
});

test("pane.move refuses for a module whose hello lacks pane_moves, and sends nothing", async () => {
  const { sent, refusal } = await move_with_hello(HELLO);
  assert.deepEqual(sent, []);
  assert.match(refusal ?? "", /Rerun its install script/);
});

test("pane.move with no hello leaves the refusal to the module call, which needs the module", async () => {
  assert.deepEqual(await move_with_hello(undefined), { sent: ['pane.move {"direction":"left"}'], refusal: "Needs the browser module" });
});
