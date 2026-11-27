// The chrome hints feature (browser_module/desertfox-chrome-hints.js) where no content script hears a key: a tab's prompt, a settings sub-dialog, the Library and Page Info.
// It drives the start from the user's own binding (the token's single use, expiry and window), what each place labels, and every end that must take the hold back.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as protocol from "../../src/shared/browser_module_protocol.ts";
import { IME_ENABLED } from "./fake_firefox.ts";
import { Node } from "./chrome_dom.ts";
import { box, browser_with_dialog, button, chrome_window, library, page_info, started, STATE } from "./chrome_windows.ts";

test("the binding typed in the Library holds the keys from its first key, asks the extension once with a token, and the controls there get labels", async () => {
  const run = started(library);
  const first = run.chrome.press("g");
  assert.ok(first.prevented, "the binding's first key went on to the tree");
  assert.equal(run.held(), "chrome_hints.prefix");
  assert.ok(run.chrome.press("B").prevented);
  assert.equal(run.held(), "chrome_hints");
  assert.equal(run.tokens().length, 1);
  assert.ok(protocol.validate_message_list(run.from_module(), protocol.MODULE_TO_EXTENSION_KINDS, Date.now()).ok);
  assert.deepEqual(await run.collect_here(5), { v: 1, reply_to: "r0", ok: true });
  const rows = run.target_rows();
  assert.deepEqual(rows.map((row) => row.slice(1)), [[10, 10, 60, 24], [80, 10, 60, 24], [400, 120, 60, 24]], "the search field got a label, or a button lost its");
  assert.equal(run.chrome.layers().length, 1);
  await run.draw(5, [[rows[0]![0]!, "a"], [rows[1]![0]!, "s"]]);
  assert.deepEqual(run.chrome.labels(), [{ text: "a", left: "10px", top: "10px" }, { text: "s", left: "80px", top: "10px" }]);
  assert.equal((await run.pick(5, rows[1]![0]!))?.ok, true);
  assert.equal((run.chrome as unknown as { organize: Node }).organize.open, true, "a menu pick did not open the menu");
  assert.equal(run.held(), undefined, "a pick left the keys held");
});

test("a start token works once: a second collect_here with it is refused and starts nothing", async () => {
  const run = started(library);
  run.type_binding();
  const token = run.tokens()[0]!;
  assert.equal((await run.collect_here(5, token))?.ok, true);
  assert.equal((await run.collect_here(6, token))?.error, "The hint key is stale");
  assert.equal(run.pushes("chrome_hints.end").length, 0, "the refused reuse ended the live session");
  assert.equal(run.chrome.layers().length, 1);
  assert.equal((await run.collect_here(7, token + 1))?.error, "The hint key is stale", "a token the module never made opened a session");
});

test("a start token expires: its timer releases the hold, and a late collect_here is refused", async () => {
  const run = started(library);
  run.type_binding();
  run.chrome.fire_timers();
  assert.equal(run.held(), undefined, "an unanswered start kept the window's keys");
  assert.ok(!run.chrome.press("j").prevented, "a key after the start expired was taken");
  assert.equal((await run.collect_here(5))?.error, "The hint key is stale");
  assert.equal(run.chrome.layers().length, 0);
});

test("a token is bound to its window: with another window in front it opens nothing there, and it is spent", async () => {
  const run = started(library);
  run.type_binding();
  const token = run.tokens()[0]!;
  const other = page_info(run.firefox);
  (run.firefox.Services.focus as { activeWindow: unknown }).activeWindow = other.win;
  assert.equal((await run.collect_here(5, token))?.error, "The window is not in front");
  assert.equal(other.layers().length + run.chrome.layers().length, 0);
  assert.equal(run.held(other.win), undefined);
  assert.equal(run.held(), undefined, "a refused start kept the keys of its window");
  (run.firefox.Services.focus as { activeWindow: unknown }).activeWindow = run.chrome.win;
  assert.equal((await run.collect_here(6, token))?.error, "The hint key is stale", "a token refused once opened a session later");
});

test("a binding typed in a field, in a page, with no binding listed or past the toolbar switch is left alone", async () => {
  const field = started(library);
  field.chrome.focus((field.chrome as unknown as { search: Node }).search);
  assert.ok(!field.type_binding().some((event) => event.prevented), "a key typed in the search field was taken");
  assert.deepEqual(field.tokens(), []);

  const remote = started(library);
  remote.chrome.win.windowUtils.IMEStatus = IME_ENABLED;
  assert.ok(!remote.type_binding().some((event) => event.prevented));

  const page = started((firefox) => {
    const window = chrome_window(firefox, "navigator:browser", (root) => root.append(button("reload-button", 10)));
    window.focus(new Node("browser", { isRemoteBrowser: true } as never));
    return window;
  });
  assert.ok(!page.type_binding().some((event) => event.prevented), "a key for the page's content script was taken");

  const unbound = started(library, { state: { ...STATE, chrome_hint_keys: undefined } });
  assert.ok(!unbound.type_binding().some((event) => event.prevented));

  const off = started(library, { state: { ...STATE, enabled: false } });
  assert.ok(!off.type_binding().some((event) => event.prevented));
  assert.deepEqual([...field.tokens(), ...remote.tokens(), ...page.tokens(), ...unbound.tokens(), ...off.tokens()], []);
});

test("a key off the binding drops the held first key and is tried alone, and Escape drops it without reaching the window", () => {
  const run = started(library);
  run.chrome.press("g");
  assert.ok(!run.chrome.press("x").prevented, "a key off the binding was taken");
  assert.equal(run.held(), undefined);
  run.chrome.press("g");
  assert.ok(run.chrome.press("Escape").prevented);
  assert.equal(run.held(), undefined);
  run.chrome.press("g");
  run.chrome.win.fire("deactivate");
  assert.equal(run.held(), undefined, "half a binding kept the keys after the window left the front");
  assert.deepEqual(run.tokens(), []);
});

test("Escape, a click, the window leaving the front and the pref off each end a start and release the hold", async () => {
  for (const end of ["Escape", "mousedown", "deactivate", "pref"]) {
    const run = started(library);
    run.type_binding();
    if (end === "Escape") assert.ok(run.chrome.press("Escape").prevented);
    else if (end === "pref") run.firefox.set_pref(false);
    else run.chrome.win.fire(end);
    assert.equal(run.held(), undefined, end);
    assert.notEqual((await run.collect_here(5))?.ok, true, end);
  }
});

test("keys typed while the extension answers wait for the labels, and the popup walk leaves them alone", async () => {
  const run = started(library, { walk: true });
  run.chrome.press("j");
  run.chrome.fire_timers();
  assert.deepEqual(run.typed, ["ArrowDown"], "the walk is not attached to the Library, so the test proves nothing");
  run.type_binding();
  // No timer runs here: the start's own timer would expire it. A walk key would wait in a timer too, which the end of the test runs.
  const early = run.chrome.press("j");
  assert.ok(early.prevented);
  assert.equal((await run.collect_here(5))?.error, undefined);
  assert.deepEqual(run.pushes("chrome_hints.key"), []);
  const rows = run.target_rows();
  await run.draw(5, [[rows[0]![0]!, "j"], [rows[1]![0]!, "k"]]);
  run.chrome.press("k");
  run.chrome.fire_timers();
  assert.deepEqual(run.pushes("chrome_hints.key").map((args) => args.key), ["j", "k"]);
  assert.deepEqual(run.typed, ["ArrowDown"], "the walk moved the tree on a key meant for the labels");
});

test("in a window opened after startup, where the walk hears keys first, a binding's first j goes to chrome hints and a j outside their places still walks", async () => {
  const run = started(library, { walk: true, state: { ...STATE, chrome_hint_keys: [["j", "B"]] } });
  const with_typing = <T extends { win: object }>(window: T) => (Object.assign(window.win, { KeyboardEvent: class { key: string; constructor(_type: string, init: { key: string }) { this.key = init.key; } } }), window);
  const other = with_typing(library(run.firefox));
  run.open_window(other);
  (run.firefox.Services.focus as { activeWindow: unknown }).activeWindow = other.win;
  const first = other.press("j");
  assert.equal(run.held(other.win), "chrome_hints.prefix", "the walk took the binding's first key");
  assert.ok(first.prevented);
  other.press("B");
  assert.equal(run.tokens().length, 1, "the binding did not start");
  assert.equal(run.held(other.win), "chrome_hints");
  other.fire_timers();
  assert.deepEqual(run.typed, [], "the walk typed an arrow key for a key of the binding");

  const picture = with_typing(chrome_window(run.firefox, "Toolkit:PictureInPicture", (root) => root.append(button("close", 10))));
  run.open_window(picture);
  assert.ok(picture.press("j").prevented, "a j that chrome hints leave alone did not walk");
  picture.fire_timers();
  assert.deepEqual(run.typed, ["ArrowDown"]);
});

test("in a tab's prompt the buttons in the dialog's shadow root get labels at their place in the window, the prompt's field gets none, and a pick clicks", async () => {
  const run = started(browser_with_dialog);
  run.type_binding();
  assert.equal((await run.collect_here(5))?.ok, true);
  const rows = run.target_rows();
  assert.deepEqual(rows.map((row) => row.slice(1)), [[500, 350, 60, 24], [600, 350, 60, 24]]);
  await run.draw(5, [[rows[0]![0]!, "a"], [rows[1]![0]!, "s"]]);
  assert.deepEqual(run.chrome.labels().map((label) => [label.left, label.top]), [["500px", "350px"], ["600px", "350px"]]);
  assert.equal((await run.pick(5, rows[1]![0]!))?.ok, true);
  const chrome = run.chrome as unknown as { cancel: Node; accept: Node; field: Node };
  assert.deepEqual([chrome.cancel.clicks, chrome.accept.clicks], [1, 0]);
});

test("a binding typed in the prompt's field starts nothing, so it types there", () => {
  const run = started(browser_with_dialog);
  run.chrome.focus((run.chrome as unknown as { field: Node }).field);
  assert.ok(!run.type_binding().some((event) => event.prevented));
  assert.deepEqual(run.tokens(), []);
});

test("a settings sub-dialog inside about:preferences adds each frame's place to its buttons' boxes", async () => {
  const run = started((firefox) => browser_with_dialog(firefox, { nested: true }));
  run.type_binding();
  assert.equal((await run.collect_here(5))?.ok, true);
  assert.deepEqual(run.target_rows().map((row) => row.slice(1, 3)), [[500, 430], [600, 430]]);
});

test("a prompt that closes mid-session, or a switch to another tab, ends the session and releases the hold", async () => {
  for (const end of ["unload", "TabSelect", "dialog click"]) {
    const run = started(browser_with_dialog);
    run.type_binding();
    await run.collect_here(5);
    const chrome = run.chrome as unknown as { dialog_view: Node };
    if (end === "unload") chrome.dialog_view.fire("unload");
    else if (end === "dialog click") chrome.dialog_view.fire("mousedown");
    else run.chrome.win.fire("TabSelect");
    assert.deepEqual(run.pushes("chrome_hints.end"), [{ session: 5 }], end);
    assert.equal(run.chrome.layers().length, 0, end);
    assert.equal(run.held(), undefined, end);
    assert.equal(chrome.dialog_view.listener_total(), 0, `${end}: a listener stayed on the dialog`);
    assert.ok(!run.chrome.press("a").prevented, end);
  }
});

test("a pick in a prompt the page replaced is refused, so a page cannot slip another button under a label", async () => {
  const run = started(browser_with_dialog);
  run.type_binding();
  await run.collect_here(5);
  const rows = run.target_rows();
  await run.draw(5, [[rows[0]![0]!, "a"], [rows[1]![0]!, "s"]]);
  const chrome = run.chrome as unknown as { accept: Node };
  chrome.accept.remove();
  assert.equal((await run.pick(5, rows[0]![0]!))?.error, "The hint's target is gone");
  assert.equal(chrome.accept.clicks, 0);
});

test("Page Info labels its sections and its permission rows", async () => {
  const run = started(page_info);
  run.type_binding();
  assert.equal((await run.collect_here(5))?.ok, true);
  assert.deepEqual(run.target_rows().map((row) => row.slice(1, 3)), [[10, 10], [80, 10], [20, 120]]);
});

test("a session in the Library ends when a newly opened window takes the front, and the new window takes the binding too", async () => {
  const run = started(library);
  run.type_binding();
  await run.collect_here(5);
  const other = page_info(run.firefox);
  run.open_window(other);
  run.chrome.win.fire("deactivate");
  (run.firefox.Services.focus as { activeWindow: unknown }).activeWindow = other.win;
  assert.deepEqual(run.pushes("chrome_hints.end"), [{ session: 5 }]);
  assert.equal(run.held(), undefined);
  other.press("g");
  other.press("B");
  assert.equal(run.tokens().length, 2, "the new window does not take the binding");
  assert.equal(run.held(other.win), "chrome_hints");
  assert.equal((await run.collect_here(6))?.ok, true);
  assert.equal(other.layers().length, 1);
});

test("the module shutting down mid-start releases the hold and leaves no listener", () => {
  const run = started(library);
  run.type_binding();
  (run.firefox.Services.desertfox_browser_module as { shut_down(): void }).shut_down();
  assert.equal(run.held(), undefined);
  assert.equal(run.chrome.window_root.listener_total(), 0);
  assert.equal(run.chrome.win.listener_total(), 0);
});

test("a dialog off the short list, such as the application chooser or the certificate manager, takes no binding and gets no labels", async () => {
  for (const url of ["chrome://mozapps/content/handling/appChooser.xhtml", "chrome://pippki/content/certManager.xhtml"]) {
    const run = started((firefox) => browser_with_dialog(firefox, { url }));
    assert.ok(!run.type_binding().some((event) => event.prevented), `${url}: the binding was taken`);
    assert.deepEqual(run.tokens(), [], url);
    assert.equal(run.chrome.layers().length, 0, url);
  }
  const settings = started((firefox) => browser_with_dialog(firefox, { url: "chrome://browser/content/preferences/dialogs/languages.xhtml" }));
  settings.type_binding();
  assert.equal((await settings.collect_here(5))?.ok, true, "a settings sub-dialog lost its labels");
});

test("a click inside the dialog while the extension answers cancels the start and releases the hold", async () => {
  const run = started(browser_with_dialog);
  run.type_binding();
  (run.chrome as unknown as { dialog_view: Node }).dialog_view.fire("mousedown");
  assert.equal(run.held(), undefined, "a click in the dialog left the start holding the keys");
  assert.equal((await run.collect_here(5))?.error, "The hint key is stale");
  assert.equal(run.chrome.layers().length, 0);
});

test("a moz- widget gets one label, not one on the host and one on the control in its shadow root", async () => {
  const toggle = new Node("moz-toggle", { id: "toggle", box: box(20, 100) });
  const inner = new Node("button", { id: "toggle-inner", box: box(20, 100) });
  const shadow = new Node("#shadow");
  shadow.append(inner);
  shadow.host = toggle;
  toggle.openOrClosedShadowRoot = shadow;
  const run = started((firefox) => browser_with_dialog(firefox, { url: "chrome://browser/content/preferences/dialogs/languages.xhtml", extra: [toggle] }));
  run.type_binding();
  await run.collect_here(5);
  assert.equal(run.target_rows().length, 3, "the toggle got two labels, or the dialog's buttons lost theirs");
});

test("a tab prompt whose kind is not known yet takes no binding and gets no labels, while a login prompt does, its OK behind Enter", () => {
  const unknown = started((firefox) => browser_with_dialog(firefox, { prompt_type: "" }));
  assert.ok(!unknown.type_binding().some((event) => event.prevented), "a prompt with no kind took the binding");
  assert.deepEqual(unknown.tokens(), []);
  for (const prompt_type of ["promptUserAndPass", "alert"]) {
    const run = started((firefox) => browser_with_dialog(firefox, { prompt_type }));
    run.type_binding();
    assert.equal(run.tokens().length, 1, `${prompt_type} lost the binding`);
  }
});
