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
    // Tracks the light DOM: true once appended to the page, false once removed.
    isConnected: false,
    listeners: {} as Record<string, () => void>,
    posted: [] as Posted[],
    contentWindow: {
      postMessage: (message: Posted["message"], origin: string, transfer: MessagePort[] = []) => void element.posted.push({ message, origin, transfer }),
    },
    attachShadow: () => ({ append: () => {} }),
    append: () => {},
    addEventListener: (type: string, listener: () => void) => void (element.listeners[type] = listener),
    focus: () => void (element.focused = true),
    remove: () => {
      element.removed = true;
      element.isConnected = false;
    },
  };
  return element;
}

// Port messages arrive on a later turn, and later still on a busy machine.
async function until(condition: () => boolean): Promise<void> {
  for (let waited = 0; !condition() && waited < 2000; waited += 5) await new Promise((resolve) => setTimeout(resolve, 5));
}
// For a message that must not arrive: long enough for one that would.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function load_host(t: TestContext, tag: string, { ticket_fails = false } = {}) {
  const modes: string[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>) => void>();
  const sinks = new Map<string, Sink>();
  const elements: ReturnType<typeof fake_element>[] = [];
  const window_listeners: Record<string, (event: unknown) => void> = {};
  const sent: unknown[] = [];
  const observers: (() => void)[] = [];
  Object.assign(globalThis, {
    MutationObserver: class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
    browser: {
      runtime: {
        getURL: (path: string) => `https://extension.test/${path}`,
        sendMessage: async (message: { type: string }) => {
          if (message.type !== "issue_cmdline_ticket") return void sent.push(message);
          if (ticket_fails) throw new Error("the background is gone");
          return "issued-ticket";
        },
      },
    },
    document: { body: { append: (child: { isConnected: boolean }) => void (child.isConnected = true) }, createElement: () => { const element = fake_element(); elements.push(element); return element; } },
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
  const [holder, frame] = elements as [ReturnType<typeof fake_element>, ReturnType<typeof fake_element>];
  // An open port keeps Node running, so a failed test would hang.
  t.after(() => frame.posted.forEach((posted) => posted.transfer.forEach((port) => port.close())));
  const on_window = (message: unknown, source: unknown) => window_listeners.message!({ data: { oasisfox_cmdline: message }, source });
  // The page answers `start` once the background took its ticket.
  const ready = async () => {
    on_window({ kind: "ready" }, frame.contentWindow);
    await until(() => frame.posted.length > 0);
  };
  const page_opened = async () => {
    frame.posted[0]!.transfer[0]!.postMessage({ oasisfox_cmdline: { kind: "opened" } });
    await until(() => frame.focused);
  };
  const page_mutated = () => observers.forEach((callback) => callback());
  return { modes, sent, holder, frame, sink: sinks.get("cmdline")!, on_window, ready, page_opened, page_mutated };
}

test("opening mounts the line, hands over the kept keys with a port, and a close over the port leaves it", async (t) => {
  const { modes, sent, holder, frame, sink, ready } = await load_host(t, "open");
  assert.deepEqual(modes, ["cmdline"]);

  // Keys before the page is ready are kept and handed over, in order, with the start message.
  assert.equal(sink.on_token("s"), "handled");
  assert.equal(sink.on_token("c"), "handled");
  await ready();
  const [start] = frame.posted;
  const { kind, ticket, text, tokens } = start!.message.oasisfox_cmdline;
  assert.deepEqual([kind, text, tokens, ticket], ["start", "open ", ["s", "c"], "issued-ticket"]);
  // Only to the extension origin, so a frame a page script sent elsewhere never sees the ticket or the port.
  assert.equal(start!.origin, "https://extension.test");

  const page_port = start!.transfer[0]!;
  page_port.postMessage({ oasisfox_cmdline: { kind: "close" } });
  await until(() => modes.length === 2);
  assert.deepEqual(modes, ["cmdline", "normal"]);
  assert.equal(holder.removed, true);
  assert.deepEqual(sent, []);
});

test("a close or submit posted on the window is ignored, even from the frame", async (t) => {
  const { modes, sent, frame, on_window, ready } = await load_host(t, "forged");
  await ready();
  const invocation = { id: "open.url", args: { url: "https://evil.example" } };
  on_window({ kind: "submit", invocation }, frame.contentWindow);
  on_window({ kind: "close" }, frame.contentWindow);
  on_window({ kind: "submit", invocation }, {});
  await settle();
  assert.deepEqual([modes, sent], [["cmdline"], []]);
});

test("a submit over the port runs, and later keys travel over the port, not the window", async (t) => {
  const { modes, sent, frame, sink, ready } = await load_host(t, "submit");
  await ready();
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
  const { modes, holder, ready, on_window, frame } = await load_host(t, "second_ready");
  await ready();
  on_window({ kind: "ready" }, frame.contentWindow);
  assert.deepEqual(modes, ["cmdline", "normal"]);
  assert.equal(holder.removed, true);
});

test("the ticket never sits in the frame's name or URL, where the page can read it before the frame loads", async (t) => {
  const { frame, ready } = await load_host(t, "no_ticket_in_frame");
  // While the frame still holds about:blank it is same-origin with the page, so a page script can read both.
  assert.equal(frame.name, "");
  assert.equal(frame.src, "https://extension.test/cmdline.html");
  await ready();
  assert.equal(frame.name, "");
});

test("a page that removes the bar closes the line", async (t) => {
  const { modes, holder, ready, page_opened, page_mutated } = await load_host(t, "removed");
  await ready();
  await page_opened();
  holder.remove();
  page_mutated();
  assert.deepEqual(modes, ["cmdline", "normal"]);
});

test("a page that sends the frame to another address closes the line", async (t) => {
  const { modes, frame, ready, page_opened } = await load_host(t, "navigated");
  // A load before `start` has no port to ask, and the ready timer covers it.
  frame.listeners.load!();
  await ready();
  const page_port = frame.posted[0]!.transfer[0]!;
  const checks: unknown[] = [];
  page_port.onmessage = (event) => {
    if (event.data.oasisfox_cmdline.kind !== "check") return;
    checks.push(event.data);
    page_port.postMessage({ oasisfox_cmdline: { kind: "here" } });
  };
  await page_opened();
  // Our page answers the check, so the line stays.
  frame.listeners.load!();
  await until(() => checks.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.deepEqual([checks, modes], [[{ oasisfox_cmdline: { kind: "check" } }], ["cmdline"]]);
  // A page somewhere else holds no port and never answers.
  page_port.onmessage = null;
  frame.listeners.load!();
  await until(() => modes.length === 2);
  assert.deepEqual(modes, ["cmdline", "normal"]);
});

test("Escape typed on the page closes the line even when the frame's port is dead", async (t) => {
  const { modes, holder, frame, sink, ready, page_opened } = await load_host(t, "dead_port");
  await ready();
  await page_opened();
  frame.posted[0]!.transfer[0]!.close();
  assert.equal(sink.on_token("<Escape>"), "handled");
  assert.deepEqual(modes, ["cmdline", "normal"]);
  assert.equal(holder.removed, true);
});

test("the ready timer runs until the page has redeemed its ticket", async (t) => {
  const { holder, ready } = await load_host(t, "timer");
  await ready();
  // The page said ready but never `opened`, as a page whose ticket the background refused. The 3 s timer still closes it.
  await new Promise((resolve) => setTimeout(resolve, 3100));
  assert.equal(holder.removed, true);
});

test("once the page opened, the host moves focus into the frame and says so after the keys it forwarded", async (t) => {
  const { frame, sink, ready } = await load_host(t, "focused");
  await ready();
  const page_port = frame.posted[0]!.transfer[0]!;
  const received: string[] = [];
  page_port.onmessage = (event) => void received.push(event.data.oasisfox_cmdline.token ?? event.data.oasisfox_cmdline.kind);
  sink.on_token("a");
  page_port.postMessage({ oasisfox_cmdline: { kind: "opened" } });
  await until(() => received.length === 2);
  assert.deepEqual([received, frame.focused], [["a", "focused"], true]);
});

test("a frame load while the page still redeems its ticket does not close a healthy line", async (t) => {
  const { modes, frame, ready } = await load_host(t, "slow_redeem");
  await ready();
  // Our own page's load can come after `start`, while the background has not answered the page yet.
  frame.listeners.load!();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.deepEqual(modes, ["cmdline"]);
});

test("a failed ticket request closes the line at once", async (t) => {
  const rejections: unknown[] = [];
  const on_rejection = (reason: unknown) => void rejections.push(reason);
  process.on("unhandledRejection", on_rejection);
  t.after(() => void process.off("unhandledRejection", on_rejection));
  const { modes, frame, on_window } = await load_host(t, "ticket_fails", { ticket_fails: true });
  await new Promise((resolve) => setTimeout(resolve, 10));
  on_window({ kind: "ready" }, frame.contentWindow);
  await until(() => modes.length === 2);
  assert.deepEqual([modes, rejections], [["cmdline", "normal"], []]);
});
