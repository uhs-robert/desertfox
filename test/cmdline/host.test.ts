import assert from "node:assert/strict";
import { test } from "node:test";

type Sink = { on_token: (token: string) => "handled" | "pass"; exit: () => void };

// Just enough DOM for the host script: elements that record what is done to them.
function fake_element() {
  const element = {
    style: { cssText: "" },
    src: "",
    removed: false,
    focused: false,
    posted: [] as unknown[],
    listeners: {} as Record<string, () => void>,
    contentWindow: { postMessage: (message: unknown) => void element.posted.push(message) },
    attachShadow: () => ({ append: () => {} }),
    append: () => {},
    addEventListener: (type: string, listener: () => void) => void (element.listeners[type] = listener),
    focus: () => void (element.focused = true),
    remove: () => void (element.removed = true),
  };
  return element;
}

test("opening mounts the line and enters cmdline mode, and a close from the page leaves it", async () => {
  const modes: string[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>) => void>();
  const sinks = new Map<string, Sink>();
  const elements: ReturnType<typeof fake_element>[] = [];
  const window_listeners: Record<string, (event: unknown) => void> = {};
  const sent: unknown[] = [];
  Object.assign(globalThis, {
    browser: { runtime: { getURL: (path: string) => `moz-extension://id/${path}`, sendMessage: async (message: unknown) => void sent.push(message) } },
    document: { body: { append: () => {} }, createElement: () => { const element = fake_element(); elements.push(element); return element; } },
    window: {
      oasisfox_host: {
        set_mode: (mode: string) => void modes.push(mode),
        register_sink: (mode: string, sink: Sink) => void sinks.set(mode, sink),
        register_handler: (id: string, handler: (args: Record<string, unknown>) => void) => void handlers.set(id, handler),
      },
      addEventListener: (type: string, listener: (event: unknown) => void) => void (window_listeners[type] = listener),
    },
  });
  // A query string makes Node evaluate the module again, as a fresh injection does.
  const host_url = new URL("../../src/cmdline/host.ts", import.meta.url).href;
  await import(`${host_url}?open`);

  handlers.get("cmdline.open")!({ text: "open " });
  assert.deepEqual(modes, ["cmdline"]);
  const [holder, frame] = elements as [ReturnType<typeof fake_element>, ReturnType<typeof fake_element>];

  // Keys before the page is ready are kept and handed over, in order, with the start message.
  const sink = sinks.get("cmdline")!;
  assert.equal(sink.on_token("s"), "handled");
  assert.equal(sink.on_token("c"), "handled");
  const from_page = (message: unknown) => window_listeners.message!({ data: { oasisfox_cmdline: message }, source: frame.contentWindow });
  from_page({ kind: "ready" });
  const start = (frame.posted[0] as { oasisfox_cmdline: unknown }).oasisfox_cmdline as { kind: string; tokens: string[]; text: string };
  assert.deepEqual([start.kind, start.text, start.tokens], ["start", "open ", ["s", "c"]]);

  // A message that does not come from the iframe is ignored.
  window_listeners.message!({ data: { oasisfox_cmdline: { kind: "close" } }, source: {} });
  assert.deepEqual(modes, ["cmdline"]);

  from_page({ kind: "close" });
  assert.deepEqual(modes, ["cmdline", "normal"]);
  assert.equal(holder.removed, true);
  assert.deepEqual(sent, []);
});
