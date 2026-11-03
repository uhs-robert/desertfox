import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";

type Sink = { on_token: (token: string) => "handled" | "pass"; exit: () => void };
type Posted = { message: { oasisfox_cmdline: Record<string, unknown> }; origin: string; transfer: MessagePort[] };

// Just enough DOM for the host script: elements that record what is done to them.
function fake_element() {
  const element = {
    style: { cssText: "" },
    src: "",
    name: "",
    removed: false,
    focused: false,
    posted: [] as Posted[],
    contentWindow: {
      postMessage: (message: Posted["message"], origin: string, transfer: MessagePort[] = []) => void element.posted.push({ message, origin, transfer }),
    },
    attachShadow: () => ({ append: () => {} }),
    append: () => {},
    focus: () => void (element.focused = true),
    remove: () => void (element.removed = true),
  };
  return element;
}

// Port messages arrive on a later turn, and later still on a busy machine.
async function until(condition: () => boolean): Promise<void> {
  for (let waited = 0; !condition() && waited < 2000; waited += 5) await new Promise((resolve) => setTimeout(resolve, 5));
}
// For a message that must not arrive: long enough for one that would.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function load_host(t: TestContext, tag: string) {
  const modes: string[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>) => void>();
  const sinks = new Map<string, Sink>();
  const elements: ReturnType<typeof fake_element>[] = [];
  const window_listeners: Record<string, (event: unknown) => void> = {};
  const sent: unknown[] = [];
  Object.assign(globalThis, {
    browser: {
      runtime: {
        getURL: (path: string) => `https://extension.test/${path}`,
        sendMessage: async (message: { type: string }) => (message.type === "issue_cmdline_ticket" ? "issued-ticket" : void sent.push(message)),
      },
    },
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
  await import(`${host_url}?${tag}`);

  handlers.get("cmdline.open")!({ text: "open " });
  // The frame loads once the background answered with a ticket.
  await until(() => elements[1]?.src !== "");
  const [holder, frame] = elements as [ReturnType<typeof fake_element>, ReturnType<typeof fake_element>];
  // An open port keeps Node running, so a failed test would hang.
  t.after(() => frame.posted.forEach((posted) => posted.transfer.forEach((port) => port.close())));
  const on_window = (message: unknown, source: unknown) => window_listeners.message!({ data: { oasisfox_cmdline: message }, source });
  return { modes, sent, holder, frame, sink: sinks.get("cmdline")!, on_window, ready: () => on_window({ kind: "ready" }, frame.contentWindow) };
}

test("opening mounts the line, hands over the kept keys with a port, and a close over the port leaves it", async (t) => {
  const { modes, sent, holder, frame, sink, ready } = await load_host(t, "open");
  assert.deepEqual(modes, ["cmdline"]);

  // Keys before the page is ready are kept and handed over, in order, with the start message.
  assert.equal(sink.on_token("s"), "handled");
  assert.equal(sink.on_token("c"), "handled");
  ready();
  const [start] = frame.posted;
  const { kind, ticket, text, tokens } = start!.message.oasisfox_cmdline;
  assert.deepEqual([kind, text, tokens], ["start", "open ", ["s", "c"]]);
  assert.equal(start!.origin, "https://extension.test");
  // The ticket from the background is the frame's name, which page scripts cannot read.
  assert.deepEqual([ticket, frame.name], ["issued-ticket", "issued-ticket"]);

  const page_port = start!.transfer[0]!;
  page_port.postMessage({ oasisfox_cmdline: { kind: "close" } });
  await until(() => modes.length === 2);
  assert.deepEqual(modes, ["cmdline", "normal"]);
  assert.equal(holder.removed, true);
  assert.deepEqual(sent, []);
});

test("a close or submit posted on the window is ignored, even from the frame", async (t) => {
  const { modes, sent, frame, on_window, ready } = await load_host(t, "forged");
  ready();
  const invocation = { id: "open.url", args: { url: "https://evil.example" } };
  on_window({ kind: "submit", invocation }, frame.contentWindow);
  on_window({ kind: "close" }, frame.contentWindow);
  on_window({ kind: "submit", invocation }, {});
  await settle();
  assert.deepEqual([modes, sent], [["cmdline"], []]);
});

test("a submit over the port runs, and later keys travel over the port, not the window", async (t) => {
  const { modes, sent, frame, sink, ready } = await load_host(t, "submit");
  ready();
  const page_port = frame.posted[0]!.transfer[0]!;
  const tokens: unknown[] = [];
  page_port.onmessage = (event) => void tokens.push(event.data);
  sink.on_token("x");
  await until(() => tokens.length === 1);
  assert.deepEqual(tokens, [{ oasisfox_cmdline: { kind: "token", token: "x" } }]);
  assert.equal(frame.posted.length, 1);

  page_port.postMessage({ oasisfox_cmdline: { kind: "submit", invocation: { id: "scroll.down" } } });
  await until(() => sent.length === 1);
  assert.deepEqual(modes, ["cmdline", "normal"]);
  assert.deepEqual(sent, [{ type: "run", invocations: [{ id: "scroll.down" }], mode: "normal" }]);
});

test("a second ready after the start closes the line", async (t) => {
  const { modes, holder, ready } = await load_host(t, "second_ready");
  ready();
  ready();
  assert.deepEqual(modes, ["cmdline", "normal"]);
  assert.equal(holder.removed, true);
});
