import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";

const SECRET = "s3cret";
const leaf = (id: string) => ({ kind: "leaf", steps: [{ invocation: { id }, runs_in: "content", count_rule: "ignore" }] });
const KEYMAP = {
  format_version: COMPILED_KEYMAP_VERSION,
  modes: { cmdline: { kind: "branch", children: { "<Enter>": leaf("cmdline.submit"), "<Escape>": leaf("mode.escape") } } },
};
const OPENED = {
  history: [],
  sources: { search_engines: [], containers: [] },
  // A snippet only the background knows, and an alias to it from `command_aliases.toml`.
  commands: [{ id: "my.jira", name: "jira", label: "Jira", intent: "" }],
  command_aliases: { j: "my.jira" },
  css: ".oasisfox-cmdline { --oasisfox-bg: red; }",
};

// Just enough DOM for the command line page. `head` records what is appended, `parent` what is posted to the web page.
async function load_page(t: TestContext, tag: string) {
  const window_listeners: ((event: unknown) => void)[] = [];
  const input_listeners: Record<string, (event: unknown) => void> = {};
  const to_parent: unknown[] = [];
  const head: { textContent: string }[] = [];
  const input = {
    value: "",
    selectionStart: 0,
    selectionEnd: 0,
    focus: () => {},
    addEventListener: (type: string, listener: (event: unknown) => void) => void (input_listeners[type] = listener),
    setRangeText(text: string, start: number, end: number) {
      input.value = input.value.slice(0, start) + text + input.value.slice(end);
      input.selectionStart = input.selectionEnd = start + text.length;
    },
  };
  const page_window = {
    name: SECRET,
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
        sendMessage: async (message: { type: string }) => (message.type === "open_cmdline" ? OPENED : undefined),
      },
      storage: { local: { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: KEYMAP }) } },
    },
    // `commands.json` holds only the built-in commands.
    fetch: async () => ({ json: async () => ({ format_version: 1, commands: [] }) }),
  });
  const page_url = new URL("../../src/cmdline/page.ts", import.meta.url).href;
  await import(`${page_url}?${tag}`);
  // `main` has run once the page says ready.
  await until(() => to_parent.length === 1);

  const ports: MessagePort[] = [];
  t.after(() => ports.forEach((port) => port.close()));
  // Posts a start the way the host does, or the way a page script can, and returns the end the sender keeps.
  const post_start = (secret: string | undefined, text: string) => {
    const channel = new MessageChannel();
    ports.push(channel.port1, channel.port2);
    const received: unknown[] = [];
    channel.port1.onmessage = (event) => void received.push(event.data);
    const data = { oasisfox_cmdline: { kind: "start", secret, text, tokens: [] } };
    for (const listener of window_listeners) listener({ data, source: page_window.parent, ports: [channel.port2] });
    return { port: channel.port1, received };
  };
  const press_enter = () => input_listeners.keydown!({ isTrusted: true, isComposing: false, key: "Enter", code: "Enter", preventDefault: () => {} });
  return { input, to_parent, head, post_start, press_enter };
}

// Port messages arrive on a later turn, and later still on a busy machine.
async function until(condition: () => boolean): Promise<void> {
  for (let waited = 0; !condition() && waited < 2000; waited += 5) await new Promise((resolve) => setTimeout(resolve, 5));
}

test("a start without the host's secret is ignored, and so is a second start", async (t) => {
  const { input, post_start } = await load_page(t, "forged_start");
  post_start(undefined, "forged");
  post_start("guess", "forged");
  assert.equal(input.value, "");
  post_start(SECRET, "real");
  post_start(SECRET, "forged");
  assert.equal(input.value, "real");
});

test("a submit goes over the host's port and never to the web page", async (t) => {
  const { to_parent, post_start, press_enter } = await load_page(t, "no_leak");
  const host = post_start(SECRET, "jira");
  press_enter();
  await until(() => host.received.length === 1);
  assert.deepEqual(to_parent, [{ oasisfox_cmdline: { kind: "ready" } }]);
  assert.deepEqual(host.received, [{ oasisfox_cmdline: { kind: "submit", invocation: { id: "my.jira" } } }]);
});

test("a configured alias resolves, and the user CSS loads", async (t) => {
  const { head, post_start, press_enter } = await load_page(t, "alias_css");
  const host = post_start(SECRET, "j");
  press_enter();
  await until(() => host.received.length === 1);
  assert.deepEqual(host.received, [{ oasisfox_cmdline: { kind: "submit", invocation: { id: "my.jira" } } }]);
  assert.deepEqual(head.map((element) => element.textContent), [OPENED.css]);
});

test("the secret is cleared from the frame's name once read", async (t) => {
  await load_page(t, "name_cleared");
  assert.equal((globalThis as unknown as { window: { name: string } }).window.name, "");
});
