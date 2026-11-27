// The chrome hints feature (browser_module/desertfox-chrome-hints.js) on the surfaces that grant: doorhangers, the downloads panel and the Library's downloads, Page Info's permissions and the grant dialogs.
// It proves that no message grants: a pick of a grant control only marks it, and only the user's own Enter in that window, on the same target and after Firefox's own delay, clicks it. Every end takes the mark and the hold away.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Node } from "./chrome_dom.ts";
import { box, browser_with_dialog, button, chrome_window, settle, started } from "./chrome_windows.ts";
import type { Firefox } from "./chrome_windows.ts";

type Window = ReturnType<typeof chrome_window>;
type Run = ReturnType<typeof started>;

const with_class = (local_name: string, class_name: string, at: ReturnType<typeof box>, props: Partial<Node> = {}) => new Node(local_name, { className: class_name, box: at, ...props });

// A doorhanger as Firefox shows one: a prompt in #notification-popup with its close button, its checkbox and its two moz-buttons, and the prompt's notification object.
function doorhanger({ popupid = "geolocation", shown_at = 0, deny_skips_delay = true } = {}) {
  const panel = new Node("panel", { id: "notification-popup", state: "open", box: box(700, 80, 360, 220) });
  const prompt = new Node("popupnotification", { id: `${popupid}-notification`, box: box(700, 80, 360, 220) });
  prompt.setAttribute("popupid", popupid);
  const close = with_class("toolbarbutton", "messageCloseButton close-icon popup-notification-closebutton", box(1030, 90, 20, 20));
  const learn_more = with_class("label", "popup-notification-learnmore-link", box(720, 150, 80, 16));
  const remember = with_class("checkbox", "popup-notification-checkbox", box(720, 180, 120, 20));
  const block = with_class("moz-button", "popup-notification-secondary-button", box(820, 250));
  const allow = with_class("moz-button", "popup-notification-primary-button", box(900, 250));
  prompt.append(close, learn_more, remember, block, allow);
  panel.append(prompt);
  const notification = { timeShown: shown_at, mainAction: {}, secondaryActions: [{ disableSecurityDelay: deny_skips_delay }] };
  Object.assign(prompt, { notification });
  return { panel, prompt, close, learn_more, remember, block, allow, notification };
}

// A browser window whose page has the focus, with a doorhanger open.
function browser_with_doorhanger(firefox: Firefox, options: Parameters<typeof doorhanger>[0] = {}) {
  const parts = doorhanger(options);
  const page = new Node("browser", { isRemoteBrowser: true, box: box(0, 80, 1200, 700) } as never);
  const window = chrome_window(firefox, "navigator:browser", (root) => root.append(button("reload-button", 10), page, parts.panel));
  window.focus(page);
  return { ...window, ...parts, page };
}

// A download row as Firefox builds one: the main area that takes the click, and the row's button with its icon class.
function download_row(name: string, top: number, { icon = "downloadIconShow", blocked = false } = {}) {
  const row = new Node("richlistitem", { id: name, box: box(710, top, 380, 40) });
  if (blocked) {
    row.setAttribute("verdict", "Uncommon");
    row.className = "temporary-block";
  }
  row.setAttribute("state", blocked ? "8" : "1");
  const main = with_class("hbox", "downloadMainArea", box(710, top, 320, 40));
  const row_button = with_class("button", `downloadButton ${icon}`, box(1040, top + 8, 40, 24));
  row.append(main, row_button);
  return { row, main, row_button };
}

// The downloads panel, open with the focus in its list: a finished download, a blocked one, the footer button and the blocked-download view.
function browser_with_downloads(firefox: Firefox) {
  const panel = new Node("panel", { id: "downloadsPanel", state: "open", box: box(700, 40, 400, 400) });
  const main_view = new Node("panelview", { id: "downloadsPanel-mainView", box: box(700, 40, 400, 400) });
  main_view.setAttribute("visible", "true");
  const list = Object.assign(new Node("richlistbox", { id: "downloadsListBox", box: box(700, 40, 400, 300) }), { selectedItem: null as Node | null, focus: () => undefined });
  const done = download_row("done", 50);
  const held_back = download_row("held-back", 100, { icon: "downloadIconSubviewArrow", blocked: true });
  list.append(done.row, held_back.row);
  const history = new Node("button", { id: "downloadsHistory", box: box(710, 400, 380, 30) });
  main_view.append(list, history);
  const blocked_view = new Node("panelview", { id: "downloadsPanel-blockedSubview", box: box(700, 40, 400, 400) });
  const unblock = new Node("button", { id: "downloadsPanel-blockedSubview-unblockButton", box: box(720, 380) });
  const remove = new Node("button", { id: "downloadsPanel-blockedSubview-deleteButton", box: box(900, 380) });
  const back = with_class("toolbarbutton", "subviewbutton subviewbutton-iconic subviewbutton-back", box(710, 50, 24, 24));
  blocked_view.append(back, unblock, remove);
  panel.append(main_view, blocked_view);
  const window = chrome_window(firefox, "navigator:browser", (root) => root.append(button("reload-button", 10), panel));
  list.focus = () => void window.focus(list);
  window.focus(list);
  // Firefox slides the blocked-download view in for the chosen row.
  const show_blocked_view = () => {
    main_view.attrs.delete("visible");
    blocked_view.setAttribute("visible", "true");
  };
  return { ...window, panel, list, done, held_back, history, back, unblock, remove, show_blocked_view };
}

// The Library on its downloads, with a finished row and a blocked one whose button asks to allow the file.
function library_with_downloads(firefox: Firefox) {
  const list = Object.assign(new Node("richlistbox", { id: "downloadsListBox", box: box(10, 100, 600, 300) }), { selectedItem: null as Node | null, focus: () => undefined, ensureElementIsVisible: () => undefined });
  const done = download_row("done", 110);
  const held_back = download_row("held-back", 160, { blocked: true });
  for (const part of [done, held_back]) {
    for (const node of [part.row, part.main, part.row_button]) node.box = { ...node.box, left: node.box.left - 700 };
  }
  list.append(done.row, held_back.row);
  const window = chrome_window(firefox, "Places:Organizer", (root) => root.append(button("back-button", 10), list));
  list.focus = () => void window.focus(list);
  window.focus(list);
  return { ...window, list, done, held_back };
}

// Page Info on its permissions: one permission's Use Default checkbox and its Allow and Block radios, which run the row's <command>.
function page_info_permissions(firefox: Firefox) {
  const group = { selectedItem: null as Node | null };
  const radio = (state: number, left: number) => {
    const node = new Node("radio", { id: `geo#${state}`, box: box(left, 130) });
    node.setAttribute("command", "cmd_geoToggle");
    return Object.assign(node, { radioGroup: group });
  };
  const allow = radio(1, 200);
  const block = radio(2, 280);
  const use_default = new Node("checkbox", { id: "geoDef", box: box(20, 130) });
  const list = new Node("vbox", { id: "permList", box: box(10, 100, 500, 300) });
  list.append(use_default, allow, block);
  const window = chrome_window(firefox, "Browser:page-info", (root) => root.append(button("permTab", 10, 10, "radio"), list, new Node("command", { id: "cmd_geoToggle" })));
  window.focus(allow);
  return { ...window, group, allow, block, use_default };
}

// How long a grant's mark shows before an Enter counts: Firefox's `security.notification_enable_delay` when unset.
const DWELL_MS = 500;

// Labels every target, so a test can pick a control by its element. After the pick the user reads the mark as long as it must show, so the next key counts.
async function labelled(run: Run, session: number) {
  const rows = run.pushes("chrome_hints.targets").filter((args) => args.session === session).flatMap((args) => JSON.parse(args.targets as string) as number[][]);
  await run.draw(session, rows.map(([id], index) => [id!, `a${String.fromCharCode(97 + index)}`]));
  return async (element: Node) => {
    const row = rows.find(([, left, top]) => left === Math.round(element.box.left) && top === Math.round(element.box.top));
    assert.ok(row, `no label on ${element.id || element.className || element.localName}`);
    const reply = await run.pick(session, row[0]!);
    run.chrome.clock.now += DWELL_MS;
    return reply;
  };
}

// The extension's own start, as gB typed in the page sends it.
async function collect(run: Run, session: number) {
  const id = run.send("chrome_hints.collect", { session, window_id: run.chrome.id, colors: "" });
  await settle();
  return run.reply(id);
}

const all_layers = (root: Node): Node[] => [root, ...root.descendants()].filter((node) => node.className === "desertfox-chrome-hints");
const marked = (window: Window) => all_layers(window.root).some((host) => host.shadow!.descendants().some((node) => node.className === "desertfox-confirm"));
const held = (run: Run) => run.held();

// The doorhanger run, picked on `target` from a session the page's gB started, the mark showing.
async function doorhanger_pick(target: (chrome: ReturnType<typeof browser_with_doorhanger>) => Node, options: Parameters<typeof doorhanger>[0] = {}) {
  const run = started((firefox) => browser_with_doorhanger(firefox, options));
  const chrome = run.chrome as unknown as ReturnType<typeof browser_with_doorhanger>;
  run.firefox.chrome_now = 5000;
  assert.equal((await collect(run, 5))?.ok, true);
  const pick = await labelled(run, 5);
  const reply = await pick(target(chrome));
  return { run, chrome, reply, shown_at: chrome.clock.now - DWELL_MS };
}

test("a pick of Allow on a doorhanger only marks it: no message clicks it, and the user's Enter in that window does", async () => {
  const { run, chrome, reply } = await doorhanger_pick((chrome) => chrome.allow);
  assert.equal(reply?.ok, true);
  assert.equal(chrome.allow.clicks, 0, "a pick granted the permission");
  assert.ok(marked(chrome), "no confirm mark shows on Allow");
  assert.equal(held(run), "chrome_hints", "the window's keys are free while Allow waits");
  // Every message the extension can send, again: none clicks.
  const ids = run.target_rows().map(([id]) => id!);
  for (const id of ids) assert.equal((await run.pick(5, id))?.error, "The hints have ended");
  run.send("chrome_hints.clear", { session: 5 });
  run.send("chrome_hints.draw", { session: 5, gen: 9, part: 0, parts: 1, typed: "", labels: "[]" });
  await settle();
  assert.equal(chrome.allow.clicks, 0, "a message granted the permission");
  assert.ok(marked(chrome), "a message ended the confirm");
  const enter = chrome.press("Enter");
  assert.ok(enter.prevented, "the confirming Enter went on to the page");
  assert.equal(chrome.allow.clicks, 1);
  assert.equal(marked(chrome), false);
  assert.equal(held(run), undefined, "the confirm kept the window's keys");
});

test("a synthetic Enter neither confirms nor cancels, and a held-down Enter or one pressed before the mark showed does nothing", async () => {
  const { run, chrome, shown_at } = await doorhanger_pick((chrome) => chrome.allow);
  assert.equal(chrome.press("Enter", { isTrusted: false }).prevented, false);
  assert.equal(chrome.press("Enter", { repeat: true }).prevented, true);
  assert.equal(chrome.press("Enter", { timeStamp: shown_at - 1 }).prevented, true);
  assert.equal(chrome.allow.clicks, 0);
  assert.ok(marked(chrome), "an Enter that does not count ended the confirm");
  chrome.press("Enter", { timeStamp: chrome.clock.now + 1 });
  assert.equal(chrome.allow.clicks, 1);
  assert.equal(held(run), undefined);
});

test("a key while the mark is new ends the confirm and grants nothing, so an Enter meant for what was there before cannot carry through", async () => {
  for (const key of ["Enter", "a"]) {
    const { run, chrome, shown_at } = await doorhanger_pick((chrome) => chrome.allow);
    assert.ok(chrome.press(key, { timeStamp: shown_at + 10 }).prevented, `${key} went on to the page`);
    assert.equal(chrome.allow.clicks, 0, `${key} right after the mark granted`);
    assert.equal(marked(chrome), false, `${key} right after the mark left the confirm up`);
    assert.equal(held(run), undefined, key);
    chrome.press("Enter");
    assert.equal(chrome.allow.clicks, 0, `${key} right after the mark, then Enter, granted`);
  }
  const { chrome, shown_at } = await doorhanger_pick((chrome) => chrome.allow);
  chrome.press("Enter", { timeStamp: shown_at + DWELL_MS });
  assert.equal(chrome.allow.clicks, 1, "an Enter once the mark had shown long enough did not grant");
});

test("the mark shows as long as Firefox's security.notification_enable_delay says", async () => {
  const run = started((firefox) => {
    firefox.set_named_pref("security.notification_enable_delay", 1000);
    return browser_with_doorhanger(firefox);
  });
  const chrome = run.chrome as unknown as ReturnType<typeof browser_with_doorhanger>;
  run.firefox.chrome_now = 5000;
  await collect(run, 5);
  await (await labelled(run, 5))(chrome.allow);
  const shown_at = chrome.clock.now - DWELL_MS;
  chrome.press("Enter", { timeStamp: shown_at + 600 });
  assert.equal(chrome.allow.clicks, 0, "an Enter inside the pref's delay granted");
  assert.equal(marked(chrome), false);
});

test("Enter does nothing once another feature holds the window's keys", async () => {
  const { run, chrome } = await doorhanger_pick((chrome) => chrome.allow);
  // The core refuses a hold over another owner's, so the confirm's own hold ends first.
  const core = run.firefox.Services.desertfox_browser_module as { hold_keys(win: unknown, owner: string): boolean; release_keys(win: unknown, owner: string): void };
  core.release_keys(chrome.win, "chrome_hints");
  assert.equal(core.hold_keys(chrome.win, "sidebar"), true);
  chrome.press("Enter");
  assert.equal(chrome.allow.clicks, 0, "an Enter granted while another feature held the keys");
  assert.equal(marked(chrome), false);
});

test("any other key cancels and goes nowhere, and Shift or Ctrl with Enter cancels too", async () => {
  for (const [key, patch] of [["Escape", {}], ["a", {}], ["Tab", {}], ["Enter", { shiftKey: true }], ["Enter", { ctrlKey: true }]] as const) {
    const { run, chrome } = await doorhanger_pick((chrome) => chrome.allow);
    assert.ok(chrome.press(key, patch).prevented, `${key} went on to the page`);
    assert.equal(marked(chrome), false, key);
    assert.equal(held(run), undefined, key);
    chrome.press("Enter");
    assert.equal(chrome.allow.clicks, 0, `${key} then Enter granted`);
  }
});

test("Enter in another window does nothing, and the confirm's window leaving the front cancels it", async () => {
  const { run, chrome } = await doorhanger_pick((chrome) => chrome.allow);
  const other = chrome_window(run.firefox, "Places:Organizer", (root) => root.append(button("back-button", 10)));
  other.press("Enter");
  assert.equal(chrome.allow.clicks, 0, "an Enter in another window granted");
  (run.firefox.Services.focus as { activeWindow: unknown }).activeWindow = other.win;
  chrome.press("Enter");
  assert.equal(chrome.allow.clicks, 0, "an Enter with another window in front granted");
  assert.equal(marked(chrome), false);
  (run.firefox.Services.focus as { activeWindow: unknown }).activeWindow = chrome.win;
  const again = await doorhanger_pick((chrome) => chrome.allow);
  again.chrome.win.fire("deactivate");
  assert.equal(marked(again.chrome), false);
  assert.equal(held(again.run), undefined);
  again.chrome.press("Enter");
  assert.equal(again.chrome.allow.clicks, 0);
});

test("Enter after the target changed does nothing: another prompt in the same element, a moved or removed button", async () => {
  const swapped = await doorhanger_pick((chrome) => chrome.allow);
  Object.assign(swapped.chrome.prompt, { notification: { ...swapped.chrome.notification } });
  swapped.chrome.press("Enter");
  assert.equal(swapped.chrome.allow.clicks, 0, "Enter granted the next prompt");
  assert.equal(held(swapped.run), undefined);

  const renamed = await doorhanger_pick((chrome) => chrome.allow);
  renamed.chrome.mutate(renamed.chrome.prompt, "popupid", "web-notifications");
  assert.equal(marked(renamed.chrome), false, "a new prompt in the element left the mark up");
  assert.equal(renamed.chrome.live_observers(), 0);

  const moved = await doorhanger_pick((chrome) => chrome.allow);
  moved.chrome.allow.box = box(600, 250);
  moved.chrome.press("Enter");
  assert.equal(moved.chrome.allow.clicks, 0, "Enter granted a button that moved");

  const removed = await doorhanger_pick((chrome) => chrome.allow);
  removed.chrome.allow.remove();
  removed.chrome.press("Enter");
  assert.equal(removed.chrome.allow.clicks, 0);
  assert.equal(held(removed.run), undefined);
});

test("Firefox's own delay holds: an Enter before it ends does nothing and keeps the mark, and the next Enter after it clicks", async () => {
  const { run, chrome } = await doorhanger_pick((chrome) => chrome.allow, { shown_at: 4800 });
  chrome.press("Enter");
  assert.equal(chrome.allow.clicks, 0, "Enter clicked before Firefox's delay ended");
  assert.ok(marked(chrome));
  assert.equal(chrome.notification.timeShown, 4800, "an early click pushed Firefox's delay");
  run.firefox.chrome_now = 5400;
  chrome.press("Enter");
  assert.equal(chrome.allow.clicks, 1);
});

test("a deny pick on a doorhanger clicks at once, Block with no delay and the close button, and one still under the delay is refused", async () => {
  for (const target of ["block", "close", "learn_more"] as const) {
    const { run, chrome, reply } = await doorhanger_pick((chrome) => chrome[target], { shown_at: 4900 });
    assert.equal(reply?.ok, true, target);
    assert.equal(chrome[target].clicks, 1, `${target} waited for Enter`);
    assert.equal(marked(chrome), false, target);
    assert.equal(held(run), undefined, target);
  }
  const early = await doorhanger_pick((chrome) => chrome.block, { shown_at: 4900, deny_skips_delay: false });
  assert.equal(early.reply?.error, "The prompt is not ready yet");
  assert.equal(early.chrome.block.clicks, 0);
});

test("a deny that stays waits for Enter: notifications' Always Block, and any Block with Remember ticked", async () => {
  const always_block = await doorhanger_pick((chrome) => chrome.block, { popupid: "web-notifications" });
  assert.equal(always_block.chrome.block.clicks, 0, "Always Block on a notifications prompt clicked at once");
  assert.ok(marked(always_block.chrome));
  always_block.chrome.press("Enter");
  assert.equal(always_block.chrome.block.clicks, 1);

  for (const popupid of ["geolocation", "webRTC-shareDevices"]) {
    const run = started((firefox) => {
      const window = browser_with_doorhanger(firefox, { popupid });
      window.remember.setAttribute("checked", "");
      return window;
    });
    const chrome = run.chrome as unknown as ReturnType<typeof browser_with_doorhanger>;
    run.firefox.chrome_now = 5000;
    await collect(run, 5);
    await (await labelled(run, 5))(chrome.block);
    assert.equal(chrome.block.clicks, 0, `${popupid}: Block with Remember ticked clicked at once`);
    assert.ok(marked(chrome), popupid);
    chrome.press("Enter");
    assert.equal(chrome.block.clicks, 1, popupid);
  }
});

test("on a doorhanger the table does not know, the second button waits for Enter, and so does any control it does not name", async () => {
  const unknown = await doorhanger_pick((chrome) => chrome.block, { popupid: "addon-install-confirmation" });
  assert.equal(unknown.chrome.block.clicks, 0, "an unknown prompt's second button clicked at once");
  assert.ok(marked(unknown.chrome));
  unknown.chrome.press("Enter");
  assert.equal(unknown.chrome.block.clicks, 1);

  const checkbox = await doorhanger_pick((chrome) => chrome.remember);
  assert.equal(checkbox.chrome.remember.clicks, 0);
  assert.ok(marked(checkbox.chrome));
});

test("every end takes the mark, the hold, the listeners and the observer away: the prompt closing, a click, the timer, a resize, a tab switch, the pref off and shut-down", async () => {
  for (const end of ["popuphidden", "mousedown", "timer", "resize", "TabSelect", "unload", "pref", "shut_down", "new session"]) {
    const { run, chrome } = await doorhanger_pick((chrome) => chrome.allow);
    const listeners = chrome.win.listener_total();
    assert.ok(listeners > 2, "the confirm added no listener");
    if (end === "popuphidden") chrome.panel.fire("popuphidden", { target: chrome.panel });
    else if (end === "timer") chrome.fire_timers();
    else if (end === "pref") run.firefox.set_pref(false);
    else if (end === "shut_down") (run.firefox.Services.desertfox_browser_module as { shut_down(): void }).shut_down();
    else if (end === "new session") await collect(run, 6);
    else chrome.win.fire(end);
    assert.equal(chrome.root.descendants().concat(chrome.prompt.descendants()).filter((node) => node.className === "desertfox-confirm").length, 0, end);
    assert.equal(marked(chrome), false, end);
    if (end !== "new session") assert.equal(held(run), undefined, end);
    assert.equal(chrome.live_observers(), 0, `${end}: the observer still watches`);
    assert.equal(chrome.panel.listener_total(), end === "new session" ? chrome.panel.listener_total() : 0, `${end}: a listener stayed on the panel`);
    chrome.press("Enter");
    assert.equal(chrome.allow.clicks, 0, `${end}: Enter granted after the end`);
  }
});

test("the mark goes inside the shown prompt, never as the panel's first child, which Firefox reads as a prompt", async () => {
  const { chrome } = await doorhanger_pick((chrome) => chrome.allow);
  assert.equal(chrome.panel.children[0], chrome.prompt);
  assert.equal(all_layers(chrome.prompt).length, 1);
});

test("gB typed with the focus in the doorhanger starts there through the token", async () => {
  const run = started((firefox) => {
    const window = browser_with_doorhanger(firefox);
    // The focused button sits in the moz-button's shadow root.
    const shadow = new Node("#shadow");
    const inner = new Node("button");
    inner.ownerDocument = window.allow.ownerDocument;
    shadow.append(inner);
    shadow.host = window.allow;
    window.focus(inner);
    return window;
  });
  run.type_binding();
  assert.equal(run.tokens().length, 1, "gB in the doorhanger was not taken");
  assert.equal((await run.collect_here(5))?.ok, true);
  assert.equal(run.target_rows().length, 5);
});

test("the downloads panel: gB in it labels the rows, a row pick opens its file only after Enter through Firefox's own click on its main area, a blocked row opens its view at once, and Allow download waits for Enter", async () => {
  const run = started(browser_with_downloads);
  const chrome = run.chrome as unknown as ReturnType<typeof browser_with_downloads>;
  run.type_binding();
  assert.equal((await run.collect_here(5))?.ok, true);
  let pick = await labelled(run, 5);
  assert.equal((await pick(chrome.done.row))?.ok, true);
  assert.equal(chrome.done.main.clicks, 0, "a row pick opened its file with no Enter");
  assert.ok(marked(chrome));
  chrome.press("Enter");
  assert.equal(chrome.list.selectedItem, chrome.done.row, "the pick did not choose the row first");
  assert.deepEqual([chrome.done.main.clicks, chrome.done.row.clicks], [1, 0], "the pick clicked the row, which does nothing");

  run.type_binding();
  await run.collect_here(6);
  pick = await labelled(run, 6);
  await pick(chrome.held_back.main.parentNode!);
  assert.equal(chrome.held_back.main.clicks, 1, "a blocked row waited to open its view");
  chrome.show_blocked_view();

  run.type_binding();
  await run.collect_here(7);
  pick = await labelled(run, 7);
  await pick(chrome.unblock);
  assert.equal(chrome.unblock.clicks, 0, "Allow download clicked on a pick");
  assert.ok(marked(chrome));
  chrome.press("Enter");
  assert.equal(chrome.unblock.clicks, 1);
});

test("the blocked-download view: the delete and back buttons click at once, and Enter after the view moved to another download does nothing", async () => {
  const run = started(browser_with_downloads);
  const chrome = run.chrome as unknown as ReturnType<typeof browser_with_downloads>;
  chrome.list.selectedItem = chrome.held_back.row;
  chrome.show_blocked_view();
  // The view that slid in leaves no element focused, so the focus is on the window document itself.
  chrome.focus(chrome.root);
  for (const [index, target] of [chrome.remove, chrome.back].entries()) {
    run.type_binding();
    await run.collect_here(5 + index);
    const pick_once = await labelled(run, 5 + index);
    await pick_once(target);
    assert.equal(target.clicks, 1, target.className || target.id);
  }
  chrome.focus(chrome.list);
  let pick;

  run.type_binding();
  await run.collect_here(7);
  pick = await labelled(run, 7);
  await pick(chrome.unblock);
  chrome.list.selectedItem = chrome.done.row;
  chrome.press("Enter");
  assert.equal(chrome.unblock.clicks, 0, "Enter unblocked another download");
});

test("a download that finishes or changes while its button waits ends the confirm", async () => {
  const run = started(browser_with_downloads);
  const chrome = run.chrome as unknown as ReturnType<typeof browser_with_downloads>;
  chrome.done.row.setAttribute("verdict", "Uncommon");
  chrome.done.row_button.className = "downloadButton downloadIconShow";
  run.type_binding();
  await run.collect_here(5);
  const pick = await labelled(run, 5);
  await pick(chrome.done.row_button);
  assert.ok(marked(chrome), "a blocked row's open button clicked at once");
  chrome.mutate(chrome.done.row, "state", "2");
  assert.equal(marked(chrome), false);
  assert.equal(held(run), undefined);
  chrome.press("Enter");
  assert.equal(chrome.done.row_button.clicks, 0);
});

test("a row's cancel, retry and show-in-folder buttons click at once", async () => {
  for (const icon of ["downloadIconCancel", "downloadIconRetry", "downloadIconShow"]) {
    const run = started(browser_with_downloads);
    const chrome = run.chrome as unknown as ReturnType<typeof browser_with_downloads>;
    chrome.done.row_button.className = `downloadButton ${icon}`;
    run.type_binding();
    await run.collect_here(5);
    const pick = await labelled(run, 5);
    await pick(chrome.done.row_button);
    assert.equal(chrome.done.row_button.clicks, 1, icon);
  }
});

test("the Library: a row pick only chooses the row, and a blocked row's button waits for Enter", async () => {
  const run = started(library_with_downloads);
  const chrome = run.chrome as unknown as ReturnType<typeof library_with_downloads>;
  run.type_binding();
  await run.collect_here(5);
  let pick = await labelled(run, 5);
  await pick(chrome.done.row);
  assert.equal(chrome.list.selectedItem, chrome.done.row);
  assert.equal(chrome.done.main.clicks, 0, "a Library row pick opened the file");
  run.type_binding();
  await run.collect_here(6);
  pick = await labelled(run, 6);
  await pick(chrome.held_back.row_button);
  assert.equal(chrome.held_back.row_button.clicks, 0);
  assert.ok(marked(chrome));
  chrome.press("Enter");
  assert.equal(chrome.held_back.row_button.clicks, 1);
});

test("Page Info: Block chooses its radio and runs the row's command at once, while Allow and Use Default wait for Enter", async () => {
  const run = started(page_info_permissions);
  const chrome = run.chrome as unknown as ReturnType<typeof page_info_permissions>;
  run.type_binding();
  await run.collect_here(5);
  let pick = await labelled(run, 5);
  await pick(chrome.block);
  assert.deepEqual([chrome.group.selectedItem, chrome.block.commands], [chrome.block, 1]);
  for (const [index, target] of [chrome.allow, chrome.use_default].entries()) {
    run.type_binding();
    await run.collect_here(6 + index);
    pick = await labelled(run, 6 + index);
    assert.equal((await pick(target))?.ok, true, target.id);
    assert.equal(target.commands + target.clicks, 0, `${target.id} granted on a pick`);
    chrome.press("Enter");
    assert.equal(target.commands + target.clicks, 1, target.id);
  }
  assert.equal(chrome.group.selectedItem, chrome.allow);
});

async function dialog_pick(url: string, target: "accept" | "cancel" | string, { windowtype = "", extra = [] as Node[] } = {}) {
  const run = started((firefox) => {
    const window = browser_with_dialog(firefox, { url, extra });
    window.accept.setAttribute("dlgtype", "accept");
    window.cancel.setAttribute("dlgtype", "cancel");
    if (windowtype) window.accept.parentNode!.host!.setAttribute("windowtype", windowtype);
    return window;
  });
  const chrome = run.chrome as unknown as ReturnType<typeof browser_with_dialog>;
  run.type_binding();
  assert.equal((await run.collect_here(5))?.ok, true, url);
  const element = target === "accept" ? chrome.accept : target === "cancel" ? chrome.cancel : extra.find((node) => node.id === target)!;
  const pick = await labelled(run, 5);
  await pick({ ...element, box: { ...element.box, left: element.box.left + 300, top: element.box.top + 200 } } as Node);
  return { run, chrome, element };
}

test("the grant dialogs: accept on the external protocol and client certificate prompts and OK on a login prompt wait for Enter, Cancel clicks at once", async () => {
  const cases: [string, string, string, boolean][] = [
    ["chrome://mozapps/content/handling/permissionDialog.xhtml", "accept", "", true],
    ["chrome://mozapps/content/handling/permissionDialog.xhtml", "cancel", "", false],
    ["chrome://pippki/content/clientauthask.xhtml", "accept", "", true],
    ["chrome://pippki/content/clientauthask.xhtml", "cancel", "", false],
    ["chrome://global/content/commonDialog.xhtml", "accept", "prompt:promptUserAndPass", true],
    ["chrome://global/content/commonDialog.xhtml", "accept", "prompt:confirm", false],
  ];
  for (const [url, target, windowtype, waits] of cases) {
    const { chrome, element } = await dialog_pick(url, target, { windowtype });
    const what = `${url} ${target} ${windowtype}`;
    assert.equal(element.clicks, waits ? 0 : 1, what);
    assert.equal(marked(chrome), waits, what);
    if (!waits) continue;
    chrome.press("Enter");
    assert.equal(element.clicks, 1, what);
  }
});

test("the external protocol prompt's remember checkbox waits for Enter, a click in the dialog cancels, and the dialog closing ends the confirm", async () => {
  const remember = new Node("input", { id: "remember", box: box(20, 120, 20, 20) });
  remember.setAttribute("type", "checkbox");
  const checkbox = await dialog_pick("chrome://mozapps/content/handling/permissionDialog.xhtml", "remember", { extra: [remember] });
  assert.equal(remember.clicks, 0);
  for (const end of ["mousedown", "unload"]) {
    const { chrome, element, run } = await dialog_pick("chrome://pippki/content/clientauthask.xhtml", "accept");
    (chrome as unknown as { dialog_view: Node }).dialog_view.fire(end);
    assert.equal(marked(chrome), false, end);
    assert.equal(held(run), undefined, end);
    chrome.press("Enter");
    assert.equal(element.clicks, 0, end);
  }
  void checkbox;
});

test("the Exceptions and site permissions dialogs: only Block, Cancel and a drop-down click at once, and every other control waits for Enter", async () => {
  const exceptions = "chrome://browser/content/preferences/dialogs/permissions.xhtml";
  const site_permissions = "chrome://browser/content/preferences/dialogs/sitePermissions.xhtml";
  const make = () => [
    ...["btnBlock", "btnAllow", "btnAdd", "removePermission", "removeAllPermissions"].map((id, index) => new Node("moz-button", { id, box: box(20 + index * 70, 100) })),
    new Node("checkbox", { id: "permissionsDisableCheckbox", box: box(20, 130) }),
    new Node("menulist", { id: "siteStatus", box: box(200, 130) }),
  ];
  const cases: [string, string, boolean][] = [
    [exceptions, "btnBlock", false],
    [exceptions, "cancel", false],
    [exceptions, "btnAllow", true],
    [exceptions, "btnAdd", true],
    [exceptions, "removePermission", true],
    [exceptions, "removeAllPermissions", true],
    [exceptions, "accept", true],
    [site_permissions, "cancel", false],
    [site_permissions, "siteStatus", false],
    [site_permissions, "removePermission", true],
    [site_permissions, "removeAllPermissions", true],
    [site_permissions, "permissionsDisableCheckbox", true],
    [site_permissions, "accept", true],
  ];
  for (const [url, id, waits] of cases) {
    const { chrome, element } = await dialog_pick(url, id, { extra: make(), windowtype: "" });
    const what = `${url.split("/").at(-1)} ${id}`;
    assert.equal(element.clicks + (element.open ? 1 : 0), waits ? 0 : 1, what);
    assert.equal(marked(chrome), waits, what);
    if (!waits) continue;
    chrome.press("Enter");
    assert.equal(element.clicks, 1, what);
  }
});

test("a dialog's accept button that Firefox keeps disabled for a moment: Enter does nothing until it is enabled", async () => {
  const { chrome, element } = await dialog_pick("chrome://pippki/content/clientauthask.xhtml", "accept");
  element.disabled = true;
  chrome.press("Enter");
  assert.equal(element.clicks, 0);
  assert.ok(marked(chrome), "an Enter on a disabled accept ended the confirm");
  element.disabled = false;
  chrome.press("Enter");
  assert.equal(element.clicks, 1);
});

test("a tab prompt's checkbox waits for Enter: on a prompt from a background tab it lets the site take the focus to its tab", async () => {
  const focus_box = new Node("checkbox", { id: "checkbox", box: box(20, 120, 200, 20) });
  const { chrome, element } = await dialog_pick("chrome://global/content/commonDialog.xhtml", "checkbox", { windowtype: "prompt:alert", extra: [focus_box] });
  assert.equal(element.clicks, 0, "the checkbox ticked on a pick");
  assert.ok(marked(chrome));
  chrome.press("Enter");
  assert.equal(element.clicks, 1);
});

test("an Enter in a dialog counts on the dialog's own clock: one pressed before the mark does nothing, and one after it confirms", async () => {
  const { chrome, element } = await dialog_pick("chrome://global/content/commonDialog.xhtml", "accept", { windowtype: "prompt:promptUserAndPass" });
  const dialog_clock = (chrome as unknown as { dialog_view: { performance: { now(): number } } }).dialog_view.performance;
  chrome.press("Enter", { timeStamp: dialog_clock.now() - DWELL_MS - 1 });
  assert.equal(element.clicks, 0, "an Enter pressed before the mark sent the login");
  assert.ok(marked(chrome), "an Enter pressed before the mark ended the confirm");
  chrome.press("Enter");
  assert.equal(element.clicks, 1, "an Enter typed in the dialog after the mark did not send the login");
});
