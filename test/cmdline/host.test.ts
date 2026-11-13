import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";

type Relayed = { type: "relay"; to: "top" | number; id: string; args: Record<string, unknown> };
type Sink = { on_token_: (token: string) => "handled" | "pass"; exit: () => void };
type Posted = { message: { desertfox_cmdline: Record<string, unknown> }; origin: string; transfer: MessagePort[] };

// Just enough DOM for the host script: elements that record what is done to them.
function fake_element() {
  const element = {
    style: { cssText: "", height: undefined as string | undefined },
    src: "",
    name: "",
    removed: false,
    focused: false,
    focus_count: 0,
    attributes: {} as Record<string, string>,
    shown: false,
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
    focus: () => {
      element.focused = true;
      element.focus_count++;
    },
    blur: () => void (element.focused = false),
    setAttribute: (name: string, value: string) => void (element.attributes[name] = value),
    showPopover: () => void (element.shown = true),
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

async function load_host(t: TestContext, tag: string, { ticket_fails = false, run_answer = undefined as (() => Promise<unknown>) | undefined, search = undefined as ((finish: (outcome: unknown) => void) => void) | undefined, scrolling_element = undefined as unknown, command = undefined as ((id: string, args: Record<string, unknown>) => Promise<unknown>) | undefined, active_element = null as unknown, subframe = false, relay = undefined as ((message: Relayed) => unknown) | undefined, open_args = {} as Record<string, unknown>, frame_size = { width: 300, height: 200 }, window_height = 600 } = {}) {
  const modes: string[] = [];
  const handlers = new Map<string, (args: Record<string, unknown>) => unknown>();
  const sinks = new Map<string, Sink>();
  const elements: ReturnType<typeof fake_element>[] = [];
  const window_listeners: Record<string, (event: unknown) => void> = {};
  const sent: unknown[] = [];
  // What the host asked the background to run in another frame, in order.
  const relays: Relayed[] = [];
  const window_focus: string[] = [];
  const calls: { id: string; args: Record<string, unknown> }[] = [];
  const observers: (() => void)[] = [];
  // What the host hands back to the page's key flow, in order, one entry per line that ended.
  const handed_back: (readonly string[])[] = [];
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
          if (message.type === "relay") {
            relays.push(message as Relayed);
            return relay?.(message as Relayed);
          }
          if (message.type !== "issue_cmdline_ticket") {
            sent.push(message);
            // An inner `run` that the test finishes by hand.
            return run_answer?.();
          }
          if (ticket_fails) throw new Error("the background is gone");
          return "issued-ticket";
        },
      },
    },
    document: { activeElement: active_element, scrollingElement: scrolling_element, documentElement: { append: (child: { isConnected: boolean }) => void (child.isConnected = true) }, createElement: () => { const element = fake_element(); elements.push(element); return element; } },
    innerWidth: frame_size.width,
    innerHeight: frame_size.height,
    window: {
      innerHeight: window_height,
      focus: () => void window_focus.push("window"),
      desertfox_host: {
        set_mode_: (mode: string) => void modes.push(mode),
        escape_: () => void modes.push("normal"),
        get_mode: () => "normal",
        // find.end and the heading commands are called here. Their answers are the test's to give.
        run_command_: (id: string, _bundle: string, args: Record<string, unknown>) => {
          calls.push({ id, args });
          return command?.(id, args) ?? new Promise((resolve) => search?.(resolve));
        },
        register_sink_: (mode: string, sink: Sink) => void sinks.set(mode, sink),
        register_handler_: (id: string, handler: (args: Record<string, unknown>) => unknown) => void handlers.set(id, handler),
        hold_keys_until_: (promise: Promise<readonly string[]>) => void promise.then((tokens) => handed_back.push(tokens)),
      },
      addEventListener: (type: string, listener: (event: unknown) => void) => void (window_listeners[type] = listener),
    },
  });
  // The top frame unless a test says otherwise.
  const fake_window = (globalThis as unknown as { window: { top?: unknown } }).window;
  fake_window.top = subframe ? {} : fake_window;
  // A query string makes Node evaluate the module again, as a fresh injection does.
  const host_url = new URL("../../src/cmdline/host.ts", import.meta.url).href;
  await import(`${host_url}?${tag}`);

  const answer = handlers.get("cmdline.open")!({ text: "open ", search: search ? "forward" : undefined, ...open_args }) as Promise<{ ok: boolean; cancelled?: true; message?: string }> | { ok: false; message: string };
  const opened_again = () => handlers.get("cmdline.open")!({ text: "again" }) as { ok: false; message: string };
  const [holder, frame] = elements as [ReturnType<typeof fake_element>, ReturnType<typeof fake_element>];
  // An open port keeps Node running, so a failed test would hang.
  t.after(() => frame?.posted.forEach((posted) => posted.transfer.forEach((port) => port.close())));
  const on_window = (message: unknown, source: unknown) => window_listeners.message!({ data: { desertfox_cmdline: message }, source });
  // The page answers `start` once the background took its ticket.
  const ready = async () => {
    on_window({ kind: "ready" }, frame.contentWindow);
    await until(() => frame.posted.length > 0);
  };
  const page_opened_ = async () => {
    frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "opened" } });
    await until(() => frame.focused);
  };
  const page_mutated = () => observers.forEach((callback) => callback());
  return { relays, window_focus, handed_back, modes, sent, calls, elements, window_listeners, handlers, holder, frame, sink: sinks.get("cmdline")!, on_window, ready, page_opened_, page_mutated, answer, opened_again };
}

test("opening mounts the line, hands over the kept keys with a port, and a close over the port leaves it", async (t) => {
  const { modes, sent, holder, frame, sink, ready } = await load_host(t, "open");
  assert.deepEqual(modes, ["cmdline"]);

  // Keys before the page is ready are kept and handed over, in order, with the start message.
  assert.equal(sink.on_token_("s"), "handled");
  assert.equal(sink.on_token_("c"), "handled");
  await ready();
  const [start] = frame.posted;
  const { kind, ticket, text, tokens } = start!.message.desertfox_cmdline;
  assert.deepEqual([kind, text, tokens, ticket], ["start", "open ", ["s", "c"], "issued-ticket"]);
  // Only to the extension origin, so a frame a page script sent elsewhere never sees the ticket or the port.
  assert.equal(start!.origin, "https://extension.test");

  const page_port = start!.transfer[0]!;
  page_port.postMessage({ desertfox_cmdline: { kind: "close" } });
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
  sink.on_token_("x");
  await until(() => tokens.length === 1);
  assert.deepEqual(tokens, [{ desertfox_cmdline: { kind: "token", token: "x" } }]);
  assert.equal(frame.posted.length, 1);

  page_port.postMessage({ desertfox_cmdline: { kind: "submit", invocation: { id: "scroll.down" } } });
  await until(() => sent.length === 1);
  assert.deepEqual(modes, ["cmdline", "normal"]);
  assert.deepEqual(sent, [{ type: "run", invocations: [{ id: "scroll.down" }], mode: "normal", from_line: true }]);
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
  const { modes, holder, ready, page_opened_, page_mutated } = await load_host(t, "removed");
  await ready();
  await page_opened_();
  holder.remove();
  page_mutated();
  assert.deepEqual(modes, ["cmdline", "normal"]);
});

test("a page that sends the frame to another address closes the line", async (t) => {
  const { modes, frame, ready, page_opened_ } = await load_host(t, "navigated");
  // A load before `start` has no port to ask, and the ready timer covers it.
  frame.listeners.load!();
  await ready();
  const page_port = frame.posted[0]!.transfer[0]!;
  const checks: unknown[] = [];
  page_port.onmessage = (event) => {
    if (event.data.desertfox_cmdline.kind !== "check") return;
    checks.push(event.data);
    page_port.postMessage({ desertfox_cmdline: { kind: "here" } });
  };
  await page_opened_();
  // Our page answers the check, so the line stays.
  frame.listeners.load!();
  await until(() => checks.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.deepEqual([checks, modes], [[{ desertfox_cmdline: { kind: "check" } }], ["cmdline"]]);
  // A page somewhere else holds no port and never answers.
  page_port.onmessage = null;
  frame.listeners.load!();
  await until(() => modes.length === 2);
  assert.deepEqual(modes, ["cmdline", "normal"]);
});

test("Escape typed on the page closes the line even when the frame's port is dead, and the frame goes after the hand-back timeout", async (t) => {
  const { modes, holder, frame, sink, ready, page_opened_, handed_back } = await load_host(t, "dead_port");
  await ready();
  await page_opened_();
  frame.posted[0]!.transfer[0]!.close();
  assert.equal(sink.on_token_("<Escape>"), "handled");
  assert.deepEqual(modes, ["cmdline", "normal"]);
  // Race: the page never answers `drain`, so the page's keys wait no longer than the timeout.
  await until(() => holder.removed);
  assert.equal(holder.removed, true);
  assert.deepEqual(handed_back, [[]]);
});

test("a line that ended moves the focus to the page first, and removes the frame only once the page handed back its late keys", async (t) => {
  const { modes, holder, frame, ready, page_opened_, handed_back } = await load_host(t, "hand_back");
  await ready();
  await page_opened_();
  const page_port = frame.posted[0]!.transfer[0]!;
  const received: string[] = [];
  page_port.onmessage = (event) => void received.push(event.data.desertfox_cmdline.kind);
  page_port.postMessage({ desertfox_cmdline: { kind: "submit", invocation: { id: "scroll.down" } } });
  await until(() => received.includes("drain"));
  // Race: keys typed after Enter still reach the frame until the focus has moved, so the frame stays and the page's keys wait.
  assert.deepEqual([modes, frame.focused, holder.removed, handed_back], [["cmdline", "normal"], false, false, []]);
  page_port.postMessage({ desertfox_cmdline: { kind: "drained", tokens: ["/", "f"] } });
  await until(() => holder.removed);
  await settle();
  assert.deepEqual(handed_back, [["/", "f"]]);
});

test("a line that ended leaves the focus on the page, not on the link that had it before the line opened", async (t) => {
  const link = fake_element();
  link.focused = true;
  const { frame, ready, page_opened_ } = await load_host(t, "focus_target", { active_element: link });
  await ready();
  await page_opened_();
  frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "close" } });
  await until(() => !frame.focused);
  assert.deepEqual([frame.focused, link.focus_count], [false, 0]);
});

test("a line that ends before its page opened hands back nothing and goes at once, and a drained while the line is open does nothing", async (t) => {
  const { holder, frame, sink, ready, handed_back } = await load_host(t, "hand_back_early");
  await ready();
  frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "drained", tokens: ["j"] } });
  await settle();
  assert.deepEqual([holder.removed, handed_back], [false, []]);
  sink.on_token_("<Escape>");
  assert.equal(holder.removed, true);
  await settle();
  assert.deepEqual(handed_back, [[]]);
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
  page_port.onmessage = (event) => void received.push(event.data.desertfox_cmdline.token ?? event.data.desertfox_cmdline.kind);
  sink.on_token_("a");
  page_port.postMessage({ desertfox_cmdline: { kind: "opened" } });
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

test("a resize over the port sets the frame holder's height, capped at the window, and a forged one on the window does nothing", async (t) => {
  const { holder, frame, on_window, ready } = await load_host(t, "resize");
  await ready();
  const start_height = holder.style.cssText;
  on_window({ kind: "resize", height: 400 }, frame.contentWindow);
  await settle();
  assert.equal(holder.style.height, undefined);
  assert.equal(holder.style.cssText, start_height);

  const page_port = frame.posted[0]!.transfer[0]!;
  page_port.postMessage({ desertfox_cmdline: { kind: "resize", height: 320 } });
  await until(() => holder.style.height === "320px");
  assert.equal(holder.style.height, "320px");
  page_port.postMessage({ desertfox_cmdline: { kind: "resize", height: 5000 } });
  await until(() => holder.style.height === "600px");
  assert.equal(holder.style.height, "600px");
  page_port.postMessage({ desertfox_cmdline: { kind: "resize", height: "tall" } });
  await settle();
  assert.equal(holder.style.height, "600px");
});

// What the sequence that opened the line sees: a promise that stays pending while the line is open.
// A search line whose find.end the test finishes by hand.
async function load_search(t: TestContext, tag: string) {
  const ended: ((outcome: unknown) => void)[] = [];
  const page = await load_host(t, tag, { search: (finish) => ended.push(finish) });
  return { ...page, finish_search: (outcome: unknown) => ended[0]!(outcome) };
}

const pending = (answer: unknown) => Promise.race([answer, new Promise((resolve) => setTimeout(() => resolve("pending"), 30))]);

test("cmdline.open stays pending while the line is open and answers done once the submitted command has run", async (t) => {
  let finish_run!: (value: unknown) => void;
  const { modes, frame, ready, answer } = await load_host(t, "answer_submit", { run_answer: () => new Promise((resolve) => (finish_run = resolve)) });
  await ready();
  assert.equal(await pending(answer), "pending");
  frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "submit", invocation: { id: "scroll.down" } } });
  await until(() => modes.length === 2);
  // The line is closed, but the submitted command has not answered yet, so the sequence does not go on.
  assert.equal(await pending(answer), "pending");
  finish_run({ ok: true });
  assert.deepEqual(await answer, { ok: true });
});

test("a submitted command that fails does not fail the sequence that opened the line", async (t) => {
  const refusal = { ok: false, refusal: { id: "open.url", message: "No such tab" } };
  const { modes, frame, ready, answer } = await load_host(t, "answer_failed_run", { run_answer: async () => refusal });
  await ready();
  frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "submit", invocation: { id: "open.url" } } });
  await until(() => modes.length === 2);
  assert.deepEqual(await answer, { ok: true });
});

test("a submitted command whose request is lost still ends the wait as done", async (t) => {
  const { modes, frame, ready, answer } = await load_host(t, "answer_lost_run", { run_answer: () => Promise.reject(new Error("The background is gone")) });
  await ready();
  frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "submit", invocation: { id: "open.url" } } });
  await until(() => modes.length === 2);
  assert.deepEqual(await answer, { ok: true });
});

test("Escape, a close from the page and an empty-line close answer cancelled", async (t) => {
  const escaped = await load_host(t, "answer_escape");
  escaped.sink.on_token_("<Escape>");
  assert.deepEqual(await escaped.answer, { ok: true, cancelled: true });

  const closed = await load_host(t, "answer_close");
  await closed.ready();
  closed.frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "close" } });
  assert.deepEqual(await closed.answer, { ok: true, cancelled: true });
});

test("the page leaving the mode (a navigation, or an unrelated key that changes the mode) answers cancelled", async (t) => {
  const { sink, answer, ready } = await load_host(t, "answer_exit");
  await ready();
  sink.exit();
  assert.deepEqual(await answer, { ok: true, cancelled: true });
});

test("committing a search answers done, and the close that follows does not turn it into cancelled", async (t) => {
  const { modes, frame, ready, answer, sink } = await load_host(t, "answer_commit");
  await ready();
  frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "find_commit" } });
  await until(() => modes.length === 2);
  sink.exit();
  assert.deepEqual(await answer, { ok: true });
});

test("the first answer wins when Escape and a close both arrive", async (t) => {
  const { sink, answer } = await load_host(t, "answer_first_wins");
  sink.on_token_("<Escape>");
  sink.exit();
  assert.deepEqual(await answer, { ok: true, cancelled: true });
});

test("opening while a line is open answers failed and leaves the first line alone", async (t) => {
  const { modes, holder, answer, opened_again } = await load_host(t, "answer_second_open");
  assert.deepEqual(opened_again(), { ok: false, message: "The command line is already open" });
  assert.deepEqual(modes, ["cmdline"]);
  assert.equal(holder.removed, false);
  assert.equal(await pending(answer), "pending");
});

test("committing a search answers done only after find.end has finished, and a find.end failure fails it", async (t) => {
  for (const [end, expected] of [[{ ok: true }, { ok: true }], [{ ok: false, message: "scan failed" }, { ok: false, message: "scan failed" }]] as const) {
    const page = await load_search(t, `search_end_${expected.ok}`);
    await page.ready();
    page.frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "find_commit" } });
    await until(() => page.modes.length === 2);
    assert.equal(await pending(page.answer), "pending");
    page.finish_search(end);
    assert.deepEqual(await page.answer, expected);
  }
});

test("the line is a top-layer popover on the root with the top layer number, shown once", async (t) => {
  const { holder } = await load_host(t, "popover");
  assert.deepEqual([holder.attributes.popover, holder.attributes["data-desertfox-layer"], holder.shown, holder.isConnected], ["manual", "2147483647", true, true]);
});

// What `mount_surface` does to the holder when a lower surface mounts: it hides it, shows it again and sends this event.
const restacked = (holder: ReturnType<typeof fake_element>) => holder.listeners["desertfox-restacked"]!();

test("a surface mounted over the open line sends the focus back to the frame and the input, once per mount", async (t) => {
  const { holder, frame, ready, page_opened_ } = await load_host(t, "restacked");
  await ready();
  const received: string[] = [];
  frame.posted[0]!.transfer[0]!.onmessage = (event) => void received.push(event.data.desertfox_cmdline.kind);
  await page_opened_();
  restacked(holder);
  await until(() => received.includes("refocus"));
  assert.deepEqual([received, frame.focus_count], [["focused", "refocus"], 2]);
  restacked(holder);
  await until(() => received.length === 3);
  assert.deepEqual([received.slice(2), frame.focus_count], [["refocus"], 3]);
});

test("two surfaces mounted in one tick send two refocus messages and nothing more", async (t) => {
  const { holder, frame, ready, page_opened_ } = await load_host(t, "two_mounts");
  await ready();
  const received: string[] = [];
  frame.posted[0]!.transfer[0]!.onmessage = (event) => void received.push(event.data.desertfox_cmdline.kind);
  await page_opened_();
  restacked(holder);
  restacked(holder);
  await settle();
  assert.deepEqual(received, ["focused", "refocus", "refocus"]);
});

test("a restack before the page opened, or after the line closed, moves no focus and sends nothing", async (t) => {
  const { holder, frame, modes, ready, page_opened_ } = await load_host(t, "restacked_early");
  restacked(holder);
  await ready();
  restacked(holder);
  const received: string[] = [];
  frame.posted[0]!.transfer[0]!.onmessage = (event) => void received.push(event.data.desertfox_cmdline.kind);
  await settle();
  assert.deepEqual([received, frame.focus_count], [[], 0]);
  await page_opened_();
  frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "close" } });
  await until(() => modes.length === 2);
  // A refocus that was in flight when the line closed.
  assert.doesNotThrow(() => restacked(holder));
  await settle();
  assert.deepEqual([received, frame.focus_count, modes], [["focused", "drain"], 1, ["cmdline", "normal"]]);
});

// The headings list: the page asks over the port, the host script answers from the hints bundle and drops the snapshot when the line is done.
const HEADINGS = [{ level: 1, text: "Title" }, { level: 2, text: "Usage" }];
const ask_for_headings = (frame: ReturnType<typeof fake_element>) => frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "list_headings" } });
const collect_messages = (frame: ReturnType<typeof fake_element>) => {
  const received: Record<string, unknown>[] = [];
  frame.posted[0]!.transfer[0]!.onmessage = (event) => void received.push(event.data.desertfox_cmdline);
  return received;
};

test("list_headings runs heading.list and the report goes back over the port", async (t) => {
  const { calls, frame, ready } = await load_host(t, "headings_list", {
    command: async (id, args) => {
      if (id === "heading.list") (args.report as (items: unknown) => void)(HEADINGS);
      return { ok: true };
    },
  });
  await ready();
  const received = collect_messages(frame);
  ask_for_headings(frame);
  await until(() => received.length === 1);
  assert.deepEqual(received, [{ kind: "headings", items: HEADINGS }]);
  assert.deepEqual(calls.map((call) => call.id), ["heading.list"]);
});

test("a failed heading.list answers an empty list, so the line does not wait for ever", async (t) => {
  const { frame, ready } = await load_host(t, "headings_failed", { command: async () => ({ ok: false, message: "DesertFox could not load hints" }) });
  await ready();
  const received = collect_messages(frame);
  ask_for_headings(frame);
  await until(() => received.length === 1);
  assert.deepEqual(received, [{ kind: "headings", items: [] }]);
});

test("a list_headings answer that arrives after the line closed is ignored, also when another line is open", async (t) => {
  let late_report!: (items: unknown) => void;
  const { calls, elements, window_listeners, handlers, frame, ready, sink } = await load_host(t, "headings_late", {
    command: (id, args) => {
      if (id === "heading.list") late_report = args.report as typeof late_report;
      return Promise.resolve({ ok: true });
    },
  });
  await ready();
  ask_for_headings(frame);
  await until(() => late_report !== undefined);
  sink.on_token_("<Escape>");
  await until(() => calls.some((call) => call.id === "heading.clear"));
  // A second line opens before the first line's answer lands: the answer must not reach the second line's port.
  handlers.get("cmdline.open")!({ text: "heading " });
  const second_frame = elements[3]!;
  window_listeners.message!({ data: { desertfox_cmdline: { kind: "ready" } }, source: second_frame.contentWindow });
  await until(() => second_frame.posted.length > 0);
  const received = collect_messages(second_frame);
  late_report(HEADINGS);
  await settle();
  assert.deepEqual(received, []);
  second_frame.posted.forEach((posted) => posted.transfer.forEach((port) => port.close()));
});

test("the snapshot is dropped when the line closes, but only if the line read the headings", async (t) => {
  const asked = await load_host(t, "headings_clear_asked", { command: async () => ({ ok: true }) });
  await asked.ready();
  ask_for_headings(asked.frame);
  await until(() => asked.calls.length === 1);
  asked.sink.on_token_("<Escape>");
  assert.deepEqual(asked.calls.map((call) => call.id), ["heading.list", "heading.clear"]);

  const not_asked = await load_host(t, "headings_clear_not_asked", { command: async () => ({ ok: true }) });
  await not_asked.ready();
  not_asked.sink.on_token_("<Escape>");
  assert.deepEqual(not_asked.calls, []);
});

test("a submit keeps the snapshot until the submitted command has run, then drops it", async (t) => {
  let finish_run!: (value: unknown) => void;
  const { modes, calls, frame, ready } = await load_host(t, "headings_clear_submit", {
    run_answer: () => new Promise((resolve) => (finish_run = resolve)),
    command: async () => ({ ok: true }),
  });
  await ready();
  ask_for_headings(frame);
  await until(() => calls.length === 1);
  frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "submit", invocation: { id: "heading.go", args: { heading: "1 Title" } } } });
  await until(() => modes.length === 2);
  assert.deepEqual(calls.map((call) => call.id), ["heading.list"]);
  finish_run({ ok: true });
  await until(() => calls.length === 2);
  assert.deepEqual(calls.map((call) => call.id), ["heading.list", "heading.clear"]);
});

test("the start message carries the scroll place the page had when the line mounted", async (t) => {
  const root = { scrollTop: 300, scrollHeight: 1000, clientHeight: 400 };
  const { frame, ready } = await load_host(t, "scroll_snapshot", { scrolling_element: root });
  // The page scrolls while the frame loads: the line keeps the place from the key press.
  root.scrollTop = 0;
  await ready();
  assert.deepEqual(frame.posted[0]!.message.desertfox_cmdline.scroll, { top: 300, max: 600 });
});

test("a page with no scrolling element starts the line with a null scroll", async (t) => {
  const { frame, ready } = await load_host(t, "scroll_none", { scrolling_element: null });
  await ready();
  assert.equal(frame.posted[0]!.message.desertfox_cmdline.scroll, null);
});

// A focused subframe keeps the keys while the top frame draws the line. These tests drive both ends: the subframe's (`subframe: true`) and the top frame's, which `open_args` marks as a line for frame 5.
const FOR_FRAME_5 = { from_frame: 5, remote_id: "line-1", mode: "insert", scroll: { top: 40, max: 900 } };
const relayed_ids = (relays: Relayed[]) => relays.map((relayed) => relayed.id);
const NO_LINE = { ok: false, message: "The frame is not there" };

test("a subframe sends the line to the top frame with its own mode and scroll place, and its keys follow", async (t) => {
  const { relays, modes, sink, elements } = await load_host(t, "remote_open", { subframe: true, scrolling_element: { scrollTop: 30, scrollHeight: 1000, clientHeight: 400 }, relay: () => new Promise(() => {}) });
  assert.equal(elements.length, 0, "nothing drawn in the subframe");
  assert.deepEqual(modes, ["cmdline"]);
  const [open] = relays;
  assert.equal(open!.to, "top");
  assert.deepEqual({ ...open!.args, remote_id: "id" }, { text: "open ", search: undefined, mode: "normal", remote_id: "id", scroll: { top: 30, max: 600 } });
  assert.equal(sink.on_token_("a"), "handled");
  assert.deepEqual(relays.at(-1), { type: "relay", to: "top", id: "cmdline.token", args: { token: "a" } });
});

test("a top frame with no room, or none at all, leaves the line to the subframe, with the keys the top frame did not take", async (t) => {
  for (const top_answer of [{ ok: false, message: "No room for the line" }, undefined]) {
    let answer_open!: (outcome: unknown) => void;
    const { sink, frame_of, ready_here } = await (async () => {
      const page = await load_host(t, `remote_no_room_${String(top_answer?.ok)}`, { subframe: true, relay: (relayed) => (relayed.id === "cmdline.open" ? new Promise((resolve) => (answer_open = resolve)) : NO_LINE) });
      return { ...page, frame_of: () => page.elements[1], ready_here: async () => (page.on_window({ kind: "ready" }, page.elements[1]!.contentWindow), await until(() => page.elements[1]!.posted.length > 0)) };
    })();
    sink.on_token_("x");
    await settle();
    answer_open(top_answer);
    await until(() => frame_of() !== undefined);
    await ready_here();
    assert.deepEqual(frame_of()!.posted[0]!.message.desertfox_cmdline.tokens, ["x"]);
  }
});

test("the top frame hands the focus back to the subframe, which then ends the line with the late keys and its own", async (t) => {
  let answer_open!: (outcome: unknown) => void;
  const { relays, handlers, sink, modes, handed_back, window_focus } = await load_host(t, "remote_focus_back", { subframe: true, relay: (relayed) => (relayed.id === "cmdline.open" ? new Promise((resolve) => (answer_open = resolve)) : relayed.id === "cmdline.token" ? NO_LINE : { ok: true }) });
  const remote_id = relays[0]!.args.remote_id;
  // A key the top frame refused: its line had already closed.
  sink.on_token_("j");
  await settle();
  assert.deepEqual(handlers.get("cmdline.focus")!({ remote_id: "an older line" }), NO_LINE);
  assert.deepEqual(handlers.get("cmdline.focus")!({ remote_id }), { ok: true });
  assert.deepEqual(window_focus, ["window"]);
  // Keys after the focus came back wait here for the end.
  sink.on_token_("k");
  answer_open({ ok: true, cancelled: true });
  handlers.get("cmdline.end")!({ remote_id, tokens: ["l"] });
  await until(() => handed_back.length === 1);
  assert.deepEqual(handed_back, [["l", "j", "k"]]);
  assert.deepEqual(modes, ["cmdline", "normal"]);
  assert.equal(relays.filter((relayed) => relayed.id === "cmdline.token").length, 1, "k stayed here");
});

test("a subframe that is too small to show refuses the focus, so the top frame keeps it", async (t) => {
  const { relays, handlers, window_focus } = await load_host(t, "remote_hidden", { subframe: true, frame_size: { width: 625, height: 1 }, relay: () => new Promise(() => {}) });
  assert.deepEqual(handlers.get("cmdline.focus")!({ remote_id: relays[0]!.args.remote_id }), NO_LINE);
  assert.deepEqual(window_focus, []);
});

test("a subframe's search runs in the subframe, sends its status up, and ends there once", async (t) => {
  const { relays, handlers, calls } = await load_host(t, "remote_search", {
    subframe: true,
    search: () => {},
    relay: (relayed) => (relayed.id === "cmdline.open" ? new Promise(() => {}) : { ok: true }),
    command: async (id, args) => {
      if (id === "find.live") (args.report as (status: string) => void)("1 of 3");
      return { ok: true };
    },
  });
  const remote_id = relays[0]!.args.remote_id;
  assert.deepEqual(handlers.get("cmdline.find_text")!({ remote_id: "an older line", text: "a" }), NO_LINE);
  await handlers.get("cmdline.find_text")!({ remote_id, text: "ab" });
  assert.deepEqual(relays.at(-1), { type: "relay", to: "top", id: "cmdline.find_status", args: { text: "1 of 3" } });
  await handlers.get("cmdline.find_end")!({ remote_id, keep: true });
  handlers.get("cmdline.end")!({ remote_id, tokens: [] });
  assert.deepEqual(
    calls.map((call) => [call.id, call.args.keep ?? call.args.text]),
    [
      ["find.live", "ab"],
      ["find.end", true],
    ],
  );
});

test("a subframe whose top frame never says the line ended leaves it after a grace time, and ends its search unkept", async (t) => {
  const { modes, calls } = await load_host(t, "remote_grace", { subframe: true, search: () => {}, relay: (relayed) => (relayed.id === "cmdline.open" ? { ok: true } : undefined), command: async () => ({ ok: true }) });
  await until(() => modes.length === 2);
  assert.deepEqual(modes, ["cmdline", "normal"]);
  assert.deepEqual(calls, [{ id: "find.end", args: { keep: false } }]);
});

test("the top frame draws a subframe's line with that frame's scroll place, and takes keys from that frame only", async (t) => {
  const { handlers, frame, ready, sink } = await load_host(t, "top_for_frame", { open_args: FOR_FRAME_5, scrolling_element: { scrollTop: 0, scrollHeight: 100, clientHeight: 100 } });
  await ready();
  assert.deepEqual([frame.posted[0]!.message.desertfox_cmdline.scroll, frame.posted[0]!.message.desertfox_cmdline.mode], [FOR_FRAME_5.scroll, "insert"]);
  const received = collect_messages(frame);
  assert.equal(handlers.get("cmdline.token")!({ from_frame: 5, token: "q" }), undefined);
  assert.deepEqual(handlers.get("cmdline.token")!({ from_frame: 6, token: "z" }), NO_LINE);
  assert.equal(sink.on_token_("w"), "handled", "the top frame's own keys still type");
  await until(() => received.length === 2);
  assert.deepEqual(received, [{ kind: "token", token: "q" }, { kind: "token", token: "w" }]);
});

test("a top frame too short for the line refuses it, so the subframe draws its own", async (t) => {
  const { elements, answer, modes } = await load_host(t, "top_no_room", { open_args: FOR_FRAME_5, window_height: 100 });
  assert.deepEqual(await answer, { ok: false, message: "No room for the line" });
  assert.deepEqual([elements, modes], [[], []]);
});

test("a key relayed after the top frame's line closed is refused, so the subframe keeps it", async (t) => {
  const { handlers, sink } = await load_host(t, "top_closed", { open_args: FOR_FRAME_5, relay: () => ({ ok: true }) });
  sink.on_token_("<Escape>");
  assert.deepEqual(handlers.get("cmdline.token")!({ from_frame: 5, token: "j" }), NO_LINE);
});

test("the top frame's search line searches the subframe, shows the status that frame sends, and ends the search there", async (t) => {
  const { relays, handlers, frame, ready, page_opened_, calls, answer } = await load_host(t, "top_search", { open_args: { ...FOR_FRAME_5, search: "forward" }, relay: (relayed) => (relayed.id === "cmdline.find_end" ? { ok: true } : { ok: true }) });
  await ready();
  await page_opened_();
  const received = collect_messages(frame);
  frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "find_text", text: "ab" } });
  await until(() => relays.length === 1);
  assert.deepEqual(relays[0], { type: "relay", to: 5, id: "cmdline.find_text", args: { remote_id: "line-1", text: "ab" } });
  handlers.get("cmdline.find_status")!({ from_frame: 6, text: "a stranger's" });
  handlers.get("cmdline.find_status")!({ from_frame: 5, text: "1 of 3" });
  await until(() => received.some((message) => message.kind === "find_status"));
  assert.deepEqual(received.filter((message) => message.kind === "find_status"), [{ kind: "find_status", text: "1 of 3" }]);
  frame.posted[0]!.transfer[0]!.postMessage({ desertfox_cmdline: { kind: "find_commit" } });
  assert.deepEqual(await answer, { ok: true });
  assert.deepEqual(relayed_ids(relays).slice(1, 3), ["cmdline.find_end", "cmdline.focus"]);
  assert.deepEqual(relays[1]!.args, { remote_id: "line-1", keep: true });
  assert.deepEqual(calls, [], "no search in the top frame");
});

test("a subframe that refuses the focus still hears the end, and the late keys stay in the top frame", async (t) => {
  for (const takes_focus of [false, true]) {
    const { relays, frame, ready, page_opened_, handed_back } = await load_host(t, `top_focus_${takes_focus}`, { open_args: FOR_FRAME_5, relay: (relayed) => (relayed.id === "cmdline.focus" ? (takes_focus ? { ok: true } : NO_LINE) : { ok: true }) });
    await ready();
    await page_opened_();
    const page_port = frame.posted[0]!.transfer[0]!;
    page_port.onmessage = (event) => event.data.desertfox_cmdline.kind === "drain" && page_port.postMessage({ desertfox_cmdline: { kind: "drained", tokens: ["x"] } });
    page_port.postMessage({ desertfox_cmdline: { kind: "close" } });
    await until(() => handed_back.length === 1);
    await until(() => relays.some((relayed) => relayed.id === "cmdline.end"));
    assert.deepEqual(relays.find((relayed) => relayed.id === "cmdline.end")?.args, { remote_id: "line-1", tokens: takes_focus ? ["x"] : [] });
    assert.deepEqual(handed_back, [takes_focus ? [] : ["x"]]);
    assert.equal(frame.focused, takes_focus, "the line's frame keeps no focus either way, the page's blur or the subframe takes it");
  }
});
