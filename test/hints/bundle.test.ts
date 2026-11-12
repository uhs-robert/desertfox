import assert from "node:assert/strict";
import { test } from "node:test";

test("the hints bundle registers a hint sink and hint.run, and registers once", async () => {
  const registered: string[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>) => void>();
  const sinks = new Map<string, { on_token_: (token: string) => string; exit: () => void }>();
  const modes: string[] = [];
  const host = {
    register_sink_: (mode: string, sink: never) => void sinks.set(mode, sink),
    register_handler_: (id: string, handler: never) => {
      registered.push(id);
      handlers.set(id, handler);
    },
    set_mode_: (mode: string) => void modes.push(mode),
    escape_: () => void modes.push("normal"),
  };
  (globalThis as Record<string, unknown>).window = { desertfox_host: host };
  const bundle_url = new URL("../../src/content/hints/main.ts", import.meta.url).href;
  await import(`${bundle_url}?first`);
  await import(`${bundle_url}?second`);
  assert.deepEqual(registered, ["page.follow", "page.focus_field", "page.heading", "copy.links", "hint.unhover", "hint.key", "heading.list", "heading.go", "heading.clear", "hint.run"]);
  assert.deepEqual([...sinks.keys()], ["hint"]);
  assert.deepEqual(modes, []);
  assert.equal(sinks.get("hint")!.on_token_("a"), "pass");
  // With no session the keys go on to the page and the keymap, whatever they mean in hint mode.
  for (const token of ["/", "<Tab>", "<S-Tab>", "<Enter>", "<Space>"]) assert.equal(sinks.get("hint")!.on_token_(token), "pass", token);
  sinks.get("hint")!.exit();
});

test("a bundle that runs before the content script's host waits for the host, so a later load still registers", async () => {
  const registered: string[] = [];
  const page: Record<string, unknown> = {};
  (globalThis as Record<string, unknown>).window = page;
  (globalThis as Record<string, unknown>).browser = { runtime: { onMessage: { addListener: () => {} } } };
  const bundle_url = new URL("../../src/content/hints/main.ts", import.meta.url).href;
  await import(`${bundle_url}?no_host`);
  assert.equal(page.desertfox_hints_ready, undefined);
  page.desertfox_host = { register_sink_: () => {}, register_handler_: (id: string) => void registered.push(id), set_mode_: () => {}, escape_: () => {} };
  await import(`${bundle_url}?with_host`);
  assert.equal(page.desertfox_hints_ready, true);
  assert.ok(registered.includes("hint.run"));
});
