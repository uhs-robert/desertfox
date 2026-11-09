import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { USER_CSS_STORAGE_KEY } from "../../src/shared/theme/apply.ts";
import { COMPILED_KEYMAP_STORAGE_KEY, COMPILED_KEYMAP_VERSION } from "../../src/shared/prefix_tree.ts";

// The ticket the host got from the background and sends in `start`.
const TICKET = "issued-ticket";
const leaf = (id: string) => ({ kind: "leaf", steps: [{ invocation: { id }, runs_in: "content", count_rule: "ignore" }] });
const KEYMAP = {
  format_version: COMPILED_KEYMAP_VERSION,
  modes: { cmdline: { kind: "branch", children: { "<Enter>": leaf("cmdline.submit"), "<Escape>": leaf("mode.escape"), "<Tab>": leaf("cmdline.next_completion") } } },
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
  help_ids: ["my.jira"],
  prompt: ">> ",
  window_id: 10,
  all_windows: false,
  statusbar_widgets: ["url", "scroll", "tabs"],
  status: { url: "https://example.org/docs/page?q=1#top", tab_index: 1, tab_count: 4 },
};

const USER_CSS = ".desertfox-cmdline { --desertfox-bg-core: red; }";

const TAB_COMMAND = { id: "tab.switch", name: "tab", label: "Switch tab", intent: "Switch tab.", params: [{ name: "tab", type: "string", rest: true, main: true, values: { from: "tabs" } }] };

// An element that keeps what the page puts in it.
function fake_element() {
  const element = {
    className: "",
    textContent: "",
    hidden: false,
    offsetHeight: 0,
    children: [] as unknown[],
    dataset: {} as Record<string, string>,
    style: { setProperty: () => {} },
    append: (...nodes: unknown[]) => void element.children.push(...nodes),
    replaceChildren: (...nodes: unknown[]) => void (element.children = nodes),
    listeners: {} as Record<string, (event: unknown) => void>,
    addEventListener: (type: string, listener: (event: unknown) => void) => void (element.listeners[type] = listener),
  };
  return element;
}

// Just enough DOM for the command line page. `head` records what is appended, `parent` what is posted to the web page.
type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
type PageSetup = { keymap?: unknown; with_tab_command?: boolean; without_prompt?: boolean; prompt?: string; widgets?: string[] };

async function load_page(t: TestContext, tag: string, { keymap = KEYMAP, with_tab_command = false, without_prompt = false, prompt: configured, widgets }: PageSetup = {}) {
  const window_listeners: ((event: unknown) => void)[] = [];
  const input_listeners: Record<string, (event: unknown) => void> = {};
  const to_parent: unknown[] = [];
  const opened_answer = { ...(without_prompt ? { ...OPENED, prompt: undefined } : { ...OPENED, ...(configured !== undefined && { prompt: configured }) }), ...(widgets && { statusbar_widgets: widgets }) };
  const head: { textContent: string }[] = [];
  const storage_listeners: StorageListener[] = [];
  // Every message the page sends to the background, in order.
  const to_background: string[] = [];
  const sent: { type: string; command_id?: string }[] = [];
  // The `complete_items` asks that wait for the test to answer them.
  const item_asks: ((items: unknown[]) => void)[] = [];
  // The tab model ports the page opened. `deliver` plays a message from the background.
  const model_ports: { name: string; disconnected: boolean; posted: unknown[]; deliver: (message: unknown) => void; drop: () => void }[] = [];
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
    focus_count: 0,
    focus: () => void input.focus_count++,
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
  const list = fake_element();
  const panel = fake_element();
  const note = fake_element();
  const status = fake_element();
  // Starts with the default that cmdline.html holds.
  const prompt = Object.assign(fake_element(), { textContent: "> " });
  const page_window = {
    parent: { postMessage: (message: unknown) => void to_parent.push(message) },
    addEventListener: (type: string, listener: (event: unknown) => void) => void (type === "message" && window_listeners.push(listener)),
  };
  Object.assign(globalThis, {
    window: page_window,
    document: {
      querySelector: (selector: string) => (selector === "#line" ? input : selector === "#list" ? list : selector === "#note" ? note : selector === ".desertfox-cmdline" ? panel : selector === ".desertfox-cmdline-prompt" ? prompt : selector === "#status" ? status : { textContent: "", hidden: true }),
      // The page listens for keys on the document. The fake sends them through the input's table.
      addEventListener: (type: string, listener: (event: unknown) => void) => void (input_listeners[type] = listener),
      body: { classList: { toggle: () => {} } },
      documentElement: { style: { visibility: "" } },
      head: { append: (element: { textContent: string }) => void head.push(element) },
      createElement: fake_element,
    },
    browser: {
      runtime: {
        connect: ({ name }: { name: string }) => {
          const listeners: ((message: unknown) => void)[] = [];
          const drop_listeners: (() => void)[] = [];
          const model_port = {
            name,
            disconnected: false,
            posted: [] as unknown[],
            // The background closes the port, for example when the opener check fails.
            drop: () => drop_listeners.forEach((listener) => listener()),
            // A disconnected port delivers nothing, as in Firefox.
            deliver: (message: unknown) => !model_port.disconnected && listeners.forEach((listener) => listener(message)),
          };
          model_ports.push(model_port);
          return { postMessage: (message: unknown) => void model_port.posted.push(message), disconnect: () => void (model_port.disconnected = true), onMessage: { addListener: (listener: (message: unknown) => void) => void listeners.push(listener) }, onDisconnect: { addListener: (listener: () => void) => void drop_listeners.push(listener) } };
        },
        getURL: (path: string) => `https://extension.test/${path}`,
        // The background answers only the ticket it issued.
        sendMessage: async (message: { type: string; ticket?: string }) => {
          to_background.push(message.type);
          sent.push(message);
          if (message.type === "complete_items") return new Promise((resolve) => void item_asks.push((items) => resolve({ items })));
          if (message.type === "open_cmdline" && message.ticket === TICKET && with_tab_command) return { ...opened_answer, commands: [...OPENED.commands, TAB_COMMAND] };
          return message.type === "open_cmdline" && message.ticket === TICKET ? opened_answer : undefined;
        },
      },
      storage: { local: { get: async () => ({ [COMPILED_KEYMAP_STORAGE_KEY]: keymap, [USER_CSS_STORAGE_KEY]: USER_CSS }) }, onChanged: { addListener: (listener: StorageListener) => void storage_listeners.push(listener) } },
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
  const post_start = (ticket: string | undefined, text: string, tokens: string[] = [], extra: Record<string, unknown> = {}) => {
    const channel = new MessageChannel();
    ports.push(channel.port1, channel.port2);
    const received: unknown[] = [];
    channel.port1.onmessage = (event) => void received.push(event.data);
    const data = { desertfox_cmdline: { kind: "start", ticket, text, tokens, ...extra } };
    for (const listener of window_listeners) listener({ data, source: page_window.parent, ports: [channel.port2] });
    // Resolves once the page took this start and said `opened`.
    const opened = () => until(() => received.some((data) => (data as { desertfox_cmdline: { kind: string } }).desertfox_cmdline.kind === "opened"));
    const submits = () => received.filter((data) => (data as { desertfox_cmdline: { kind: string } }).desertfox_cmdline.kind === "submit");
    return { port: channel.port1, received, opened, submits };
  };
  const press_enter = () => input_listeners.keydown!({ isTrusted: true, isComposing: false, key: "Enter", code: "Enter", preventDefault: () => {} });
  const press = (key: string) => input_listeners.keydown!({ isTrusted: true, isComposing: false, key, code: key, preventDefault: () => {} });
  return { input, list, panel, note, prompt, status, to_parent, to_background, sent, item_asks, model_ports, head, storage_listeners, post_start, press_enter, press };
}

// Port messages arrive on a later turn, and later still on a busy machine.
async function until(condition: () => boolean): Promise<void> {
  for (let waited = 0; !condition() && waited < 2000; waited += 5) await new Promise((resolve) => setTimeout(resolve, 5));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const submit_of = (id: string) => [{ desertfox_cmdline: { kind: "submit", invocation: { id } } }];

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
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  press_enter();
  await until(() => host.submits().length === 1);
  assert.deepEqual(to_parent, [{ desertfox_cmdline: { kind: "ready" } }]);
  assert.deepEqual(host.submits(), submit_of("my.jira"));
});

test("the prompt shows the configured text", async (t) => {
  const { prompt, post_start } = await load_page(t, "prompt_text");
  await post_start(TICKET, "j").opened();
  assert.equal(prompt.textContent, OPENED.prompt);
});

test("the caret preset keeps the page default text and style", async (t) => {
  const { prompt, post_start } = await load_page(t, "prompt_caret", { prompt: "caret" });
  await post_start(TICKET, "j").opened();
  assert.deepEqual([prompt.textContent, prompt.className], ["> ", ""]);
});

test("the colon preset shows a colon with the colon class", async (t) => {
  const { prompt, post_start } = await load_page(t, "prompt_colon", { prompt: "colon" });
  await post_start(TICKET, "j").opened();
  assert.deepEqual([prompt.textContent, prompt.className.trim()], [":", "desertfox-cmdline-prompt-colon"]);
});

test("the colon class styles the prompt in the primary color with the old gap", () => {
  const html = readFileSync(new URL("../../src/cmdline/cmdline.html", import.meta.url), "utf8");
  const rule = html.match(/\.desertfox-cmdline-prompt-colon \{([^}]*)\}/)![1]!;
  assert.match(rule, /color: var\(--desertfox-primary\)/);
  assert.match(rule, /margin-right: \.5rem/);
});

test("the prompt keeps the page default when no prompt is configured", async (t) => {
  const { prompt, post_start } = await load_page(t, "prompt_default", { without_prompt: true });
  await post_start(TICKET, "j").opened();
  assert.equal(prompt.textContent, "> ");
});

test("a configured alias resolves, and the user CSS loads after the theme sheet", async (t) => {
  const { head, post_start, press_enter } = await load_page(t, "alias_css");
  const host = post_start(TICKET, "j");
  await host.opened();
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  press_enter();
  await until(() => host.submits().length === 1);
  assert.deepEqual(host.submits(), submit_of("my.jira"));
  assert.deepEqual(head.map((element) => element.textContent), ["", USER_CSS]);
});

test("a user CSS change while the line is open reaches the page", async (t) => {
  const { head, storage_listeners, post_start } = await load_page(t, "css_change");
  await post_start(TICKET, "j").opened();
  storage_listeners.forEach((listener) => listener({ [USER_CSS_STORAGE_KEY]: { newValue: ".desertfox-cmdline { color: blue; }" } }, "local"));
  assert.equal(head[1]!.textContent, ".desertfox-cmdline { color: blue; }");
});

test("a copy that a site embedded itself, with a ticket it made up, sends no history over the site's port", async (t) => {
  // The site learned the extension origin from an earlier `ready`, embedded cmdline.html and sends its own start.
  const { post_start } = await load_page(t, "embedded_copy");
  const site = post_start("made-up", "", ["<ArrowUp>", "<Enter>"]);
  site.port.postMessage({ desertfox_cmdline: { kind: "token", token: "<ArrowUp>" } });
  site.port.postMessage({ desertfox_cmdline: { kind: "token", token: "<Enter>" } });
  await settle();
  assert.deepEqual(site.received, []);
});

test("keys the host forwarded before the page opened are typed once it has", async (t) => {
  const { input, post_start } = await load_page(t, "queued_tokens");
  const host = post_start(TICKET, "open");
  host.port.postMessage({ desertfox_cmdline: { kind: "token", token: "<Space>" } });
  host.port.postMessage({ desertfox_cmdline: { kind: "token", token: "x" } });
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
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  press_enter();
  await until(() => host.submits().length === 1);
  assert.deepEqual(host.submits(), submit_of("my.jira"));
});

test("the page answers the host's check after a frame load", async (t) => {
  const { post_start } = await load_page(t, "check");
  const host = post_start(TICKET, "");
  await host.opened();
  host.port.postMessage({ desertfox_cmdline: { kind: "check" } });
  await until(() => host.received.length === 2);
  assert.deepEqual(host.received.at(-1), { desertfox_cmdline: { kind: "here" } });
});

test("an Enter typed in the frame waits for the keys the host forwarded before it", async (t) => {
  const { post_start, press_enter } = await load_page(t, "key_order");
  const host = post_start(TICKET, "jir");
  await host.opened();
  // The host forwarded "a", then moved focus, and the user's Enter reached the frame before "a" left the port.
  host.port.postMessage({ desertfox_cmdline: { kind: "token", token: "a" } });
  press_enter();
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  await until(() => host.submits().length === 1);
  assert.deepEqual(host.submits(), submit_of("my.jira"));
});

test("Enter on a command that lacks a value shows the error, keeps the line open and sends nothing", async (t) => {
  const { input, to_background, post_start, press_enter } = await load_page(t, "precheck_missing");
  const host = post_start(TICKET, "fetch ");
  await host.opened();
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  press_enter();
  await settle();
  assert.deepEqual(host.submits(), []);
  // Nothing but the one ticket redemption: no history record, no run, no close.
  assert.deepEqual(to_background, ["open_cmdline"]);
  assert.equal(host.received.filter((data) => (data as { desertfox_cmdline: { kind: string } }).desertfox_cmdline.kind === "close").length, 0);
  assert.equal(input.value, "fetch ");
});

test("after the missing value is typed, the same open line submits once", async (t) => {
  const { input, to_background, post_start, press_enter } = await load_page(t, "precheck_then_valid");
  const host = post_start(TICKET, "fetch ");
  await host.opened();
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  press_enter();
  await settle();
  host.port.postMessage({ desertfox_cmdline: { kind: "token", token: "x" } });
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
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  press_enter();
  await settle();
  assert.deepEqual(host.submits(), []);
  assert.deepEqual(to_background, ["open_cmdline"]);
});

test("the list shows every command when the line opens, and the host hears the height the panel needs", async (t) => {
  const { list, panel, post_start } = await load_page(t, "list_on_open");
  panel.offsetHeight = 140;
  const host = post_start(TICKET, "");
  await host.opened();
  assert.equal(list.children.length, OPENED.commands.length);
  assert.equal(list.hidden, false);
  const resizes = host.received.filter((data) => (data as { desertfox_cmdline: { kind: string } }).desertfox_cmdline.kind === "resize");
  assert.deepEqual(resizes, [{ desertfox_cmdline: { kind: "resize", height: 140 } }]);
});

test("Tab previews a command in the line and Enter submits what the line shows", async (t) => {
  const { input, post_start, press, press_enter } = await load_page(t, "tab_then_enter");
  const host = post_start(TICKET, "");
  await host.opened();
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  await settle();
  press("Tab");
  assert.equal(input.value, "fetch ");
  press("Tab");
  assert.equal(input.value, "jira");
  press_enter();
  await until(() => host.submits().length === 1);
  assert.deepEqual(host.submits(), submit_of("my.jira"));
});

test("a page that never redeemed a ticket asks the background for no tabs and opens no model port, even with a tab line prefilled", async (t) => {
  const { to_background, item_asks, model_ports, post_start } = await load_page(t, "unredeemed_asks_nothing", { with_tab_command: true });
  const forged = [post_start(undefined, "tab "), post_start("guess", "tab ")];
  await settle();
  assert.deepEqual(to_background, ["open_cmdline", "open_cmdline"]);
  assert.deepEqual(item_asks, []);
  assert.deepEqual(model_ports, []);
  assert.deepEqual(forged.map((site) => site.received), [[], []]);
});

test("a line with no tab subject opens no model port", async (t) => {
  const { model_ports, post_start } = await load_page(t, "plain_line_no_port", { with_tab_command: true });
  const host = post_start(TICKET, "open ");
  await host.opened();
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  await settle();
  assert.deepEqual(model_ports, []);
});

const ROW = { id: 1, window_id: 10, index: 0, title: "Alpha", url: "https://alpha.test/", favicon_url: "", site: "alpha.test", pinned: false, muted: false, audible: false, discarded: false, active: false, previous: false, window_number: 1, container: "", container_name: "", container_color: "", container_icon: "" };

test("the first tab read opens one model port, the list shows the snapshot, and a patch redraws without a keypress", async (t) => {
  const { list, to_background, model_ports, post_start, press } = await load_page(t, "tabs_arrive", { with_tab_command: true });
  const host = post_start(TICKET, "tab ");
  await host.opened();
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  await until(() => model_ports.length === 1);
  press("a");
  assert.deepEqual(model_ports.map((port) => port.name), ["desertfox_tab_model"]);
  assert.equal(to_background.filter((type) => type === "complete_items").length, 0);
  assert.equal(list.children.length, 0);
  model_ports[0]!.deliver({ type: "snapshot", rev: 0, tabs: [ROW] });
  await until(() => list.children.length === 1);
  assert.equal(list.children.length, 1);
  model_ports[0]!.deliver({ type: "patch", rev: 1, upserts: [{ ...ROW, id: 2, index: 1, title: "Alpine" }], removed: [] });
  await until(() => list.children.length === 2);
  assert.equal(list.children.length, 2);
  assert.equal(model_ports.length, 1);
});

test("a patch that skips a number asks for a snapshot once", async (t) => {
  const { model_ports, post_start } = await load_page(t, "tabs_gap", { with_tab_command: true });
  const host = post_start(TICKET, "tab ");
  await host.opened();
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  await until(() => model_ports.length === 1);
  model_ports[0]!.deliver({ type: "snapshot", rev: 0, tabs: [ROW] });
  model_ports[0]!.deliver({ type: "patch", rev: 3, upserts: [], removed: [] });
  model_ports[0]!.deliver({ type: "patch", rev: 4, upserts: [], removed: [] });
  assert.deepEqual(model_ports[0]!.posted, [{ type: "resync" }]);
});

test("a port the background closes before any snapshot leaves the loading state with a note", async (t) => {
  const { model_ports, post_start, note } = await load_page(t, "tabs_port_dropped", { with_tab_command: true });
  const host = post_start(TICKET, "tab ");
  await host.opened();
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  await until(() => model_ports.length === 1);
  model_ports[0]!.drop();
  await settle();
  assert.equal(model_ports.length, 1);
  assert.equal(note.textContent, "could not read the tabs");
});

test("the model port closes with the line", async (t) => {
  const { model_ports, post_start, press_enter } = await load_page(t, "tabs_port_closes", { with_tab_command: true });
  const host = post_start(TICKET, "tab a");
  await host.opened();
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  await until(() => model_ports.length === 1);
  press_enter();
  await until(() => host.submits().length === 1);
  assert.equal(model_ports[0]!.disconnected, true);
});

test("a snapshot sent after the line submitted never arrives", async (t) => {
  const { list, model_ports, post_start, press_enter } = await load_page(t, "tabs_after_close", { with_tab_command: true });
  const host = post_start(TICKET, "tab a");
  await host.opened();
  host.port.postMessage({ desertfox_cmdline: { kind: "focused" } });
  await until(() => model_ports.length === 1);
  press_enter();
  await until(() => host.submits().length === 1);
  const drawn = list.children.length;
  model_ports[0]!.deliver({ type: "snapshot", rev: 0, tabs: [ROW] });
  await settle();
  assert.equal(list.children.length, drawn);
});

test("a refocus from the host focuses the input and leaves the caret and selection alone", async (t) => {
  const { input, post_start } = await load_page(t, "refocus");
  const host = post_start(TICKET, "open here");
  await host.opened();
  input.setSelectionRange(2, 6);
  const before = input.focus_count;
  host.port.postMessage({ desertfox_cmdline: { kind: "refocus" } });
  await until(() => input.focus_count === before + 1);
  assert.deepEqual([input.focus_count, input.value, input.selectionStart, input.selectionEnd], [before + 1, "open here", 2, 6]);
});

// A click target the way the page reads it: the name cell with a help id, or an item with its index.
const click_on_name = (help: string) => ({ target: { closest: (selector: string) => (selector === ".desertfox-cmdline-link" ? { dataset: { help } } : undefined) } });
const click_on_item = (index: number) => ({ target: { closest: (selector: string) => (selector === "[data-index]" ? { dataset: { index: String(index) } } : undefined) } });

test("a click on a command name asks for its help and closes the line", async (t) => {
  const { list, sent, post_start } = await load_page(t, "click_help");
  const host = post_start(TICKET, "ji");
  await host.opened();
  list.listeners.click!(click_on_name("my.jira"));
  await until(() => sent.some((message) => message.type === "open_help"));
  assert.deepEqual(sent.filter((message) => message.type === "open_help"), [{ type: "open_help", command_id: "my.jira" }]);
  await until(() => host.received.some((data) => (data as { desertfox_cmdline: { kind: string } }).desertfox_cmdline.kind === "close"));
  assert.ok(host.received.some((data) => (data as { desertfox_cmdline: { kind: string } }).desertfox_cmdline.kind === "close"));
});

test("a click elsewhere on a row picks it by absolute index and sends no help request", async (t) => {
  const { input, list, sent, post_start } = await load_page(t, "click_pick");
  await post_start(TICKET, "").opened();
  list.listeners.click!(click_on_item(1));
  assert.equal(input.value, "jira");
  assert.equal(sent.some((message) => message.type === "open_help"), false);
});

test("a press on the list keeps the focus in the input", async (t) => {
  const { list, post_start } = await load_page(t, "mousedown");
  await post_start(TICKET, "").opened();
  let prevented = false;
  list.listeners.mousedown!({ preventDefault: () => void (prevented = true) });
  assert.equal(prevented, true);
});

// What the status area shows: the text of each child span, its title and its color class.
type StatusSpan = { textContent: string; title?: string; className: string };
const shown_widgets = (status: ReturnType<typeof fake_element>) => (status.children as StatusSpan[]).map((span) => [span.textContent, span.title, span.className]);

test("the status area shows the widgets in the setting's order, from the snapshots of the open", async (t) => {
  const { status, post_start } = await load_page(t, "status_order");
  const host = post_start(TICKET, "", [], { scroll: { top: 300, max: 600 } });
  await host.opened();
  assert.deepEqual(shown_widgets(status), [
    ["example.org/docs/page", "https://example.org/docs/page?q=1#top", "desertfox-cmdline-status-ok"],
    ["50%", undefined, ""],
    ["[2/4]", undefined, ""],
  ]);
  assert.equal(status.hidden, false);
});

test("a reordered setting reorders the widgets, and an empty one hides the area", async (t) => {
  const reordered = await load_page(t, "status_reordered", { widgets: ["tabs", "scroll"] });
  const first = reordered.post_start(TICKET, "", [], { scroll: { top: 0, max: 600 } });
  await first.opened();
  assert.deepEqual(shown_widgets(reordered.status).map(([text]) => text), ["[2/4]", "Top"]);

  const empty = await load_page(t, "status_empty", { widgets: [] });
  await empty.post_start(TICKET, "").opened();
  assert.equal(empty.status.hidden, true);
});

test("a page with no scrolling element reads as All", async (t) => {
  const { status, post_start } = await load_page(t, "status_all", { widgets: ["scroll"] });
  await post_start(TICKET, "", [], { scroll: null }).opened();
  assert.deepEqual(shown_widgets(status).map(([text]) => text), ["All"]);
});

test("a search line shows no widgets", async (t) => {
  const { status, post_start } = await load_page(t, "status_search");
  await post_start(TICKET, "", [], { search: "forward", scroll: { top: 1, max: 600 } }).opened();
  assert.deepEqual(status.children, []);
});
