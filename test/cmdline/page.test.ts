import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";

// The ticket the host got from the background and put in the frame's name.
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
  commands: [{ id: "my.jira", name: "jira", label: "Jira", intent: "" }],
  command_aliases: { j: "my.jira" },
  css: ".oasisfox-cmdline { --oasisfox-bg: red; }",
};

// Just enough DOM for the command line page. `head` records what is appended, `parent` what is posted to the web page.
type PageSetup = { frame_name?: string; keymap?: unknown };

async function load_page(t: TestContext, tag: string, { frame_name = TICKET, keymap = KEYMAP }: PageSetup = {}) {
  const window_listeners: ((event: unknown) => void)[] = [];
  const input_listeners: Record<string, (event: unknown) => void> = {};
  const to_parent: unknown[] = [];
  const head: { textContent: string }[] = [];
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
    name: frame_name,
    parent: { postMessage: (message: unknown) => void to_parent.push(message) },
    addEventListener: (type: string, listener: (event: unknown) => void) => void (type === "message" && window_listeners.push(listener)),
  };
  Object.assign(globalThis, {
    window: page_window,
    document: {
      querySelector: (selector: string) => (selector === "#line" ? input : { textContent: "", hidden: true }),
      body: { classList: { toggle: () => {} } },
      head: { append: (element: { textContent: string }) => void head.push(element) },
      createElement: () => ({ textContent: "" }),
    },
    browser: {
      runtime: {
        getURL: (path: string) => `https://extension.test/${path}`,
        // The background answers only the ticket it issued. Before tickets it answered every frame, which is how the
        // fake answers a request with none.
        sendMessage: async (message: { type: string; ticket?: string }) =>
          message.type === "open_cmdline" && (message.ticket === undefined || message.ticket === TICKET) ? OPENED : undefined,
      },
      storage: { local: { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap }) } },
    },
    // `commands.json` holds only the built-in commands.
    fetch: async () => ({ json: async () => ({ format_version: 1, commands: [] }) }),
  });
  const page_url = new URL("../../src/cmdline/page.ts", import.meta.url).href;
  await import(`${page_url}?${tag}`);
  // `main` has run once the page says ready. A page that never says so gets the wait in full.
  await until(() => to_parent.length === 1);

  const ports: MessagePort[] = [];
  t.after(() => ports.forEach((port) => port.close()));
  // Posts a start the way the host does, or the way a page script can, and returns the end the sender keeps.
  // `secret` repeats the ticket under its old field name, so the test also reads true against the page before tickets.
  const post_start = (ticket: string | undefined, text: string, tokens: string[] = []) => {
    const channel = new MessageChannel();
    ports.push(channel.port1, channel.port2);
    const received: unknown[] = [];
    channel.port1.onmessage = (event) => void received.push(event.data);
    const data = { oasisfox_cmdline: { kind: "start", ticket, secret: ticket, text, tokens } };
    for (const listener of window_listeners) listener({ data, source: page_window.parent, ports: [channel.port2] });
    return { port: channel.port1, received };
  };
  const press_enter = () => input_listeners.keydown!({ isTrusted: true, isComposing: false, key: "Enter", code: "Enter", preventDefault: () => {} });
  const press = (key: string) => input_listeners.keydown!({ isTrusted: true, isComposing: false, key, code: key, preventDefault: () => {} });
  return { input, to_parent, head, post_start, press_enter, press };
}

// Port messages arrive on a later turn, and later still on a busy machine.
async function until(condition: () => boolean): Promise<void> {
  for (let waited = 0; !condition() && waited < 2000; waited += 5) await new Promise((resolve) => setTimeout(resolve, 5));
}

test("a start without the host's ticket is ignored, and so is a second start", async (t) => {
  const { input, post_start } = await load_page(t, "forged_start");
  post_start(undefined, "forged");
  post_start("guess", "forged");
  assert.equal(input.value, "");
  post_start(TICKET, "real");
  post_start(TICKET, "forged");
  assert.equal(input.value, "real");
});

test("a submit goes over the host's port and never to the web page", async (t) => {
  const { to_parent, post_start, press_enter } = await load_page(t, "no_leak");
  const host = post_start(TICKET, "jira");
  press_enter();
  await until(() => host.received.length === 1);
  assert.deepEqual(to_parent, [{ oasisfox_cmdline: { kind: "ready" } }]);
  assert.deepEqual(host.received, [{ oasisfox_cmdline: { kind: "submit", invocation: { id: "my.jira" } } }]);
});

test("a configured alias resolves, and the user CSS loads", async (t) => {
  const { head, post_start, press_enter } = await load_page(t, "alias_css");
  const host = post_start(TICKET, "j");
  press_enter();
  await until(() => host.received.length === 1);
  assert.deepEqual(host.received, [{ oasisfox_cmdline: { kind: "submit", invocation: { id: "my.jira" } } }]);
  assert.deepEqual(head.map((element) => element.textContent), [OPENED.css]);
});

test("the ticket is cleared from the frame's name once read", async (t) => {
  await load_page(t, "name_cleared");
  assert.equal((globalThis as unknown as { window: { name: string } }).window.name, "");
});

test("a copy that a site embedded itself, with a name it chose, sends no history over the site's port", async (t) => {
  // The site learned the extension origin from an earlier `ready`, embedded cmdline.html, named it, and sends a matching start.
  const { to_parent, post_start } = await load_page(t, "embedded_copy", { frame_name: "attacker" });
  const site = post_start("attacker", "", ["<ArrowUp>", "<Enter>"]);
  site.port.postMessage({ oasisfox_cmdline: { kind: "token", token: "<ArrowUp>" } });
  site.port.postMessage({ oasisfox_cmdline: { kind: "token", token: "<Enter>" } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual([to_parent, site.received], [[], []]);
});

test("Left then Backspace typed during the load edit before the caret", async (t) => {
  const { input, post_start } = await load_page(t, "edit_keys");
  post_start(TICKET, "open x", ["<ArrowLeft>", "<Backspace>"]);
  assert.equal(input.value, "openx");
});

test("a stored keymap with no cmdline mode still lets Enter submit", async (t) => {
  const { post_start, press_enter } = await load_page(t, "no_cmdline_mode", { keymap: { ...KEYMAP, modes: {} } });
  const host = post_start(TICKET, "jira");
  press_enter();
  await until(() => host.received.length === 1);
  assert.deepEqual(host.received, [{ oasisfox_cmdline: { kind: "submit", invocation: { id: "my.jira" } } }]);
});
