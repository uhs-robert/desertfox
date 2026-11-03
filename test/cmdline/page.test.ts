import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";

// The ticket the host got from the background and sends in `start`.
const TICKET = "issued-ticket";
const leaf = (id: string) => ({ kind: "leaf", steps: [{ invocation: { id }, runs_in: "content", count_rule: "ignore" }] });
const KEYMAP = {
  format_version: COMPILED_KEYMAP_VERSION,
  modes: { cmdline: { kind: "branch", children: { "<Enter>": leaf("cmdline.submit"), "<Escape>": leaf("mode.escape") } } },
};
const OPENED = {
  history: ["open https://private.example"],
  sources: { search_engines: [], containers: [] },
  // A snippet only the background knows, and an alias to it from `command_aliases.toml`.
  commands: [
    { id: "my.jira", name: "jira", label: "Jira", intent: "" },
    { id: "my.move", name: "move", label: "Move", intent: "", params: [{ name: "offset", type: "int" }, { name: "wrap", type: "bool", default: false }] },
    { id: "my.fetch", name: "fetch", label: "Fetch", intent: "", params: [{ name: "url", type: "string", main: true }] },
  ],
  command_aliases: { j: "my.jira" },
  css: ".oasisfox-cmdline { --oasisfox-bg: red; }",
};

// Just enough DOM for the command line page. `head` records what is appended, `parent` what is posted to the web page.
type PageSetup = { keymap?: unknown };

async function load_page(t: TestContext, tag: string, { keymap = KEYMAP }: PageSetup = {}) {
  const window_listeners: ((event: unknown) => void)[] = [];
  const input_listeners: Record<string, (event: unknown) => void> = {};
  const to_parent: unknown[] = [];
  const head: { textContent: string }[] = [];
  // Every message the page sends to the background, in order.
  const to_background: string[] = [];
  // Setting the value puts the caret at the end, as Firefox does.
  let value = "";
  const input = {
    get value() {
      return value;
    },
    set value(next: string) {
      value = next;
      input.selectionStart = input.selectionEnd = next.length;
    },
    selectionStart: 0,
    selectionEnd: 0,
    focus: () => {},
    setSelectionRange(start: number, end: number) {
      input.selectionStart = start;
      input.selectionEnd = end;
    },
    addEventListener: (type: string, listener: (event: unknown) => void) => void (input_listeners[type] = listener),
    setRangeText(text: string, start: number, end: number) {
      value = value.slice(0, start) + text + value.slice(end);
      input.selectionStart = input.selectionEnd = start + text.length;
    },
  };
  const page_window = {
    parent: { postMessage: (message: unknown) => void to_parent.push(message) },
    addEventListener: (type: string, listener: (event: unknown) => void) => void (type === "message" && window_listeners.push(listener)),
  };
  Object.assign(globalThis, {
    window: page_window,
    document: {
      querySelector: (selector: string) => (selector === "#line" ? input : { textContent: "", hidden: true }),
      // The page listens for keys on the document. The fake sends them through the input's table.
      addEventListener: (type: string, listener: (event: unknown) => void) => void (input_listeners[type] = listener),
      body: { classList: { toggle: () => {} } },
      head: { append: (element: { textContent: string }) => void head.push(element) },
      createElement: () => ({ textContent: "" }),
    },
    browser: {
      runtime: {
        getURL: (path: string) => `https://extension.test/${path}`,
        // The background answers only the ticket it issued.
        sendMessage: async (message: { type: string; ticket?: string }) => {
          to_background.push(message.type);
          return message.type === "open_cmdline" && message.ticket === TICKET ? OPENED : undefined;
        },
      },
      storage: { local: { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap }) } },
    },
    // `commands.json` holds only the built-in commands.
    fetch: async () => ({ json: async () => ({ format_version: 1, commands: [] }) }),
  });
  const page_url = new URL("../../src/cmdline/page.ts", import.meta.url).href;
  await import(`${page_url}?${tag}`);
  await until(() => to_parent.length === 1);

  const ports: MessagePort[] = [];
  t.after(() => ports.forEach((port) => port.close()));
  // Posts a start the way the host does, or the way a page script can, and returns the end the sender keeps.
  const post_start = (ticket: string | undefined, text: string, tokens: string[] = []) => {
    const channel = new MessageChannel();
    ports.push(channel.port1, channel.port2);
    const received: unknown[] = [];
    channel.port1.onmessage = (event) => void received.push(event.data);
    const data = { oasisfox_cmdline: { kind: "start", ticket, text, tokens } };
    for (const listener of window_listeners) listener({ data, source: page_window.parent, ports: [channel.port2] });
    // Resolves once the page took this start and said `opened`.
    const opened = () => until(() => received.some((data) => (data as { oasisfox_cmdline: { kind: string } }).oasisfox_cmdline.kind === "opened"));
    const submits = () => received.filter((data) => (data as { oasisfox_cmdline: { kind: string } }).oasisfox_cmdline.kind === "submit");
    return { port: channel.port1, received, opened, submits };
  };
  const press_enter = () => input_listeners.keydown!({ isTrusted: true, isComposing: false, key: "Enter", code: "Enter", preventDefault: () => {} });
  const press = (key: string) => input_listeners.keydown!({ isTrusted: true, isComposing: false, key, code: key, preventDefault: () => {} });
  return { input, to_parent, to_background, head, post_start, press_enter, press };
}

// Port messages arrive on a later turn, and later still on a busy machine.
async function until(condition: () => boolean): Promise<void> {
  for (let waited = 0; !condition() && waited < 2000; waited += 5) await new Promise((resolve) => setTimeout(resolve, 5));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const submit_of = (id: string) => [{ oasisfox_cmdline: { kind: "submit", invocation: { id } } }];

test("a start with a ticket the background refuses gets nothing, and the host's start still opens the line", async (t) => {
  const { input, post_start } = await load_page(t, "forged_start");
  // A page script posts first, without a ticket and with a guess.
  const forged = [post_start(undefined, "forged"), post_start("guess", "forged")];
  const host = post_start(TICKET, "real");
  await host.opened();
  post_start(TICKET, "late");
  await settle();
  assert.equal(input.value, "real");
  assert.deepEqual(forged.map((site) => site.received), [[], []]);
});

test("a submit goes over the host's port and never to the web page", async (t) => {
  const { to_parent, post_start, press_enter } = await load_page(t, "no_leak");
  const host = post_start(TICKET, "jira");
  await host.opened();
  host.port.postMessage({ oasisfox_cmdline: { kind: "focused" } });
  press_enter();
  await until(() => host.submits().length === 1);
  assert.deepEqual(to_parent, [{ oasisfox_cmdline: { kind: "ready" } }]);
  assert.deepEqual(host.submits(), submit_of("my.jira"));
});

test("a configured alias resolves, and the user CSS loads", async (t) => {
  const { head, post_start, press_enter } = await load_page(t, "alias_css");
  const host = post_start(TICKET, "j");
  await host.opened();
  host.port.postMessage({ oasisfox_cmdline: { kind: "focused" } });
  press_enter();
  await until(() => host.submits().length === 1);
  assert.deepEqual(host.submits(), submit_of("my.jira"));
  assert.deepEqual(head.map((element) => element.textContent), [OPENED.css]);
});

test("a copy that a site embedded itself, with a ticket it made up, sends no history over the site's port", async (t) => {
  // The site learned the extension origin from an earlier `ready`, embedded cmdline.html and sends its own start.
  const { post_start } = await load_page(t, "embedded_copy");
  const site = post_start("made-up", "", ["<ArrowUp>", "<Enter>"]);
  site.port.postMessage({ oasisfox_cmdline: { kind: "token", token: "<ArrowUp>" } });
  site.port.postMessage({ oasisfox_cmdline: { kind: "token", token: "<Enter>" } });
  await settle();
  assert.deepEqual(site.received, []);
});

test("keys the host forwarded before the page opened are typed once it has", async (t) => {
  const { input, post_start } = await load_page(t, "queued_tokens");
  const host = post_start(TICKET, "open");
  host.port.postMessage({ oasisfox_cmdline: { kind: "token", token: "<Space>" } });
  host.port.postMessage({ oasisfox_cmdline: { kind: "token", token: "x" } });
  await until(() => input.value === "open x");
  assert.equal(input.value, "open x");
});

test("Left then Backspace typed during the load edit before the caret", async (t) => {
  const { input, post_start } = await load_page(t, "edit_keys");
  await post_start(TICKET, "open x", ["<ArrowLeft>", "<Backspace>"]).opened();
  assert.equal(input.value, "openx");
});

test("a stored keymap with no cmdline mode still lets Enter submit", async (t) => {
  const { post_start, press_enter } = await load_page(t, "no_cmdline_mode", { keymap: { ...KEYMAP, modes: {} } });
  const host = post_start(TICKET, "jira");
  await host.opened();
  host.port.postMessage({ oasisfox_cmdline: { kind: "focused" } });
  press_enter();
  await until(() => host.submits().length === 1);
  assert.deepEqual(host.submits(), submit_of("my.jira"));
});

test("the page answers the host's check after a frame load", async (t) => {
  const { post_start } = await load_page(t, "check");
  const host = post_start(TICKET, "");
  await host.opened();
  host.port.postMessage({ oasisfox_cmdline: { kind: "check" } });
  await until(() => host.received.length === 2);
  assert.deepEqual(host.received.at(-1), { oasisfox_cmdline: { kind: "here" } });
});

test("an Enter typed in the frame waits for the keys the host forwarded before it", async (t) => {
  const { post_start, press_enter } = await load_page(t, "key_order");
  const host = post_start(TICKET, "jir");
  await host.opened();
  // The host forwarded "a", then moved focus, and the user's Enter reached the frame before "a" left the port.
  host.port.postMessage({ oasisfox_cmdline: { kind: "token", token: "a" } });
  press_enter();
  host.port.postMessage({ oasisfox_cmdline: { kind: "focused" } });
  await until(() => host.submits().length === 1);
  assert.deepEqual(host.submits(), submit_of("my.jira"));
});

test("Enter on a command that lacks a value shows the error, keeps the line open and sends nothing", async (t) => {
  const { input, to_background, post_start, press_enter } = await load_page(t, "precheck_missing");
  const host = post_start(TICKET, "fetch ");
  await host.opened();
  host.port.postMessage({ oasisfox_cmdline: { kind: "focused" } });
  press_enter();
  await settle();
  assert.deepEqual(host.submits(), []);
  // Nothing but the one ticket redemption: no history record, no run, no close.
  assert.deepEqual(to_background, ["open_cmdline"]);
  assert.equal(host.received.filter((data) => (data as { oasisfox_cmdline: { kind: string } }).oasisfox_cmdline.kind === "close").length, 0);
  assert.equal(input.value, "fetch ");
});

test("after the missing value is typed, the same open line submits once", async (t) => {
  const { input, to_background, post_start, press_enter } = await load_page(t, "precheck_then_valid");
  const host = post_start(TICKET, "fetch ");
  await host.opened();
  host.port.postMessage({ oasisfox_cmdline: { kind: "focused" } });
  press_enter();
  await settle();
  host.port.postMessage({ oasisfox_cmdline: { kind: "token", token: "x" } });
  await until(() => input.value === "fetch x");
  press_enter();
  await until(() => host.submits().length === 1);
  await settle();
  assert.equal(host.submits().length, 1);
  assert.deepEqual(to_background, ["open_cmdline", "record_cmdline"]);
});

test("an empty value on a required param without a default counts as missing", async (t) => {
  const { to_background, post_start, press_enter } = await load_page(t, "precheck_empty");
  const host = post_start(TICKET, "move --offset=");
  await host.opened();
  host.port.postMessage({ oasisfox_cmdline: { kind: "focused" } });
  press_enter();
  await settle();
  assert.deepEqual(host.submits(), []);
  assert.deepEqual(to_background, ["open_cmdline"]);
});
