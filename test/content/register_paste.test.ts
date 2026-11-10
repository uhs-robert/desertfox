// `<C-r><reg>` in insert mode: the `text` bundle reads the register from the background and types it through the shared field writer.

import assert from "node:assert/strict";
import { test } from "node:test";

class FakeHTMLElement {
  tagName = "INPUT";
  type = "text";
  isContentEditable = false;
  isConnected = true;
}
class FakeHTMLInputElement extends FakeHTMLElement {}
const globals = globalThis as Record<string, unknown>;
globals.HTMLElement = FakeHTMLElement;
globals.HTMLInputElement = FakeHTMLInputElement;

const typed: string[] = [];
const asked: unknown[] = [];
let stored: unknown;
const handlers = new Map<string, (args: Record<string, unknown>) => unknown>();
globals.document = { activeElement: new FakeHTMLInputElement(), execCommand: (_command: string, _ui: boolean, text: string) => (typed.push(text), true) };
globals.browser = { runtime: { sendMessage: async (message: unknown) => (asked.push(message), stored) } };
globals.window = {
  desertfox_host: { register_handler_: (id: string, handler: (args: Record<string, unknown>) => unknown) => handlers.set(id, handler), last_blurred_: () => undefined },
  addEventListener: () => {},
};
await import("../../src/content/text/main.ts");
const paste = (name: string) => handlers.get("register.paste")!({ name }) as Promise<void>;

test("the register text goes into the focused field", async () => {
  stored = "hello";
  await paste("a");
  assert.deepEqual(asked, [{ type: "register_read", name: "a" }]);
  assert.deepEqual(typed, ["hello"]);
});

test("an empty register or one that holds a macro refuses and types nothing", async () => {
  typed.length = 0;
  for (const [value, message] of [[undefined, /Register b is empty/], ["", /Register b is empty/], [[{ id: "page.reload" }], /holds a macro/]] as const) {
    stored = value;
    await assert.rejects(paste("b"), message);
  }
  assert.deepEqual(typed, []);
});

test("a paste refuses when focus moved to another field during the register read", async () => {
  typed.length = 0;
  stored = "late";
  const doc = globals.document as { activeElement: unknown };
  const first = doc.activeElement;
  (globals.browser as { runtime: { sendMessage: unknown } }).runtime.sendMessage = async () => ((doc.activeElement = new FakeHTMLInputElement()), "late");
  await assert.rejects(paste("a"), /Focus moved/);
  assert.deepEqual(typed, []);
  doc.activeElement = first;
});
