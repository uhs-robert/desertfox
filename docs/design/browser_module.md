# The browser module

Area: the browser module, the optional second tier beside the native host.
READMEs: `browser_module/README.md`.
Source: `browser_module`. The channel it reads is in [host.md](host.md#browser-module) and `src/shared/browser_module_protocol.ts`.

## What it is

A content script never runs on Firefox's own pages, the restricted sites, the PDF viewer or Reader View. It also misses a tab that has not committed its page (see [Constraints from Firefox](../design.md#constraints-from-firefox)). The browser module takes DesertFox's tab and scroll keys there. It is a set of plain script files that Firefox loads with browser privileges from a drop-in folder. It is not in the xpi, and the extension and the host never install, download or load it.

- The user installs it with `sudo browser_module/install.sh`, and removes it with `--uninstall`. The script copies every `desertfox-*.js` file of the folder into `chrome.d` in the Firefox install folder (`DESERTFOX_FIREFOX_DIR`, default `/usr/lib/firefox`) as root, mode 0644. It refuses a folder that is missing, a link, not owned by root, or writable by group or others. It never creates the folder or touches `mozilla.cfg`. A loader must already read the folder. Oasis Dots ships one.
- The loader contract: a regular `*.js` file in `chrome.d` runs once per browser window, after `browser-delayed-startup-finished`. Files run in name order, each in its own `try`, with the window as the global. The loader skips a link and a file the browser user can write.
- Two switches. The Firefox pref `desertfox.browser_module.enabled` is the kill switch. It is unset (off) by default, so the user sets it to `true` in about:config. The setting `browser_module` is the extension's consent to write the state. Both must be on.

## Files

- `desertfox-browser.js` is the core. It reads and checks the state, says the hello and reads and writes the message lists. It decides whether a key is DesertFox's to take on this page. Its frame script reports each document.
- `desertfox-statusbar.js` draws the status bar (see the next section). It is not a command feature.
- Each feature is its own file that sorts after the core (`desertfox-tabs-scroll.js` runs `tab.next`, `tab.prev`, `scroll.lines`, `scroll.pixels`, `scroll.pages` and `scroll.to`, and `desertfox-panes.js` answers the pane kinds). A later feature adds a file and touches no other.
- The core lives in a system sandbox that the first window builds by loading the core file into it, once per process. A listener the process keeps then holds no closed window alive. In a window, the core file only attaches the window, and a feature file only asks the core to load it into the sandbox (`adopt`). The core loads only files from its own folder.
- The surface for feature files, on `Services.desertfox_browser_module`: `define_command(id, { args, run })`, `add_frame_script(fn)`, `register_kind(kind, handler)`, `send(kind, args)`, `log_once(text)`, `may_act(win)`, `on_shut_down(fn)`, `sidebar_row(win, keys)`, `token_of(event)`, `type_key(win, key, still_holds)` and, in a window, `adopt(file_url)`. `args` names the shape of each arg (`int`, `number`, `enum` with `values`), and the core runs `run({ window, browser, tab, args, repeat })` only for a row whose args fit. The header of the core file documents it.
- A feature file lets an error in its start throw. The core then turns the module off for the session, so a feature that started halfway never takes keys.

## When the module takes a key

All of these must hold, checked on each keydown in the capture phase of the browser window. Otherwise the key goes on as if the module were not there.

1. The event is trusted, not part of an IME composition and not prevented. The pref is `true`.
2. The key is for a tab's page. A key in the browser UI, DevTools (docked toolbox or any panel), a sidebar or a popup is not. Its document is no content document of a tab browser. So DevTools' own keys keep working.
3. DesertFox is running, and in a private window it has private window access.
4. The state is valid: the right `v`, `enabled` true, unknown fields ignored. The module applies the protocol's limits (32 key rows, 1024 tabs) and checks each field it reads, so a state past them claims nothing. An extension reload empties `storage.session`, so the module takes nothing until the new extension writes the state again.
5. The key's token (the same normalization as `src/shared/keys/token.ts`) has a row whose command a feature defined, with args of the right shape.
6. The focus is not in a field. A page in the parent process is read directly: the deep active element, the event's own target and design mode. A remote page is read from its frame script's report. A key can come before the report. The window's input state (`windowUtils.IMEStatus`) covers it, because Firefox sets it when a text field takes the focus.
7. The tab is in normal mode. A tab the state does not list is normal and not live.
8. DesertFox is not live in the shown document. No report for the current inner window counts a DesertFox keydown listener, and the tab has no live mark. A report from an older document of the tab does not count.

The module runs the command first, then prevents and stops the key in the parent, so the page and the content script never see it. A command that throws leaves the key to the page. Tab keys run `advanceSelectedTab`, which wraps. Scroll keys go to the feature's frame script. It scrolls the focused element's scrolling ancestor, else the page when it scrolls. Else it scrolls the largest scrolling box, such as the settings pane of about:preferences or the PDF viewer's pages. In the PDF viewer DesertFox's keys win, so pdf.js loses its own `j` and `k`.

## Sidebar keys

`desertfox-sidebar.js` takes keys in Firefox's own sidebar: the vertical tab strip (with `sidebar.verticalTabs` on) and the history, bookmarks and open tabs panels. It never takes a key in another panel, such as an add-on's sidebar, whose page it does not know. It attaches its own keydown listener to each browser window's root, because a key there is not for a page and the core leaves it alone.

- The keys come from `sidebar_keys` in the state, built from the keymap's `sidebar` mode: rows of one or two key tokens, each naming one `sidebar.*` command. A bad table is left out whole, and the other keys stay. The module holds the first key of a two-key row (`gg`) per window. Escape, a focus move or a window blur drops it. Any other key tries the pair, then itself alone.
- A key is taken only with the focus in one of those places, the module allowed to act there (`may_act`) and no menu or walking panel open (the popup walk owns those keys). In a text field, such as a panel's search box (a field in a shadow root included), only the `sidebar.leave` row is taken.
- In a panel the moves, open, expand and collapse type arrow keys, Home, End or Enter through the core's `type_key`, so Firefox keeps its own selection, scrolling and folding. `type_key` types only those keys, after the current key event, and never with the focus in a text field or DevTools. A typed key passes the feature's own listener untouched, so a typed Enter never runs `sidebar.open` again. In the strip they move the strip's own keyboard focus (`ariaFocusedItem`), select the tab or fold its group.
- `sidebar.close_item` closes the open tabs row's tab or the strip's tab. It is not taken in history or bookmarks, where a close would delete data. `sidebar.filter` focuses the panel's search box, and in the strip opens Firefox's all tabs panel.
- `sidebar.leave` (Escape) from the search box goes to the list. Elsewhere it gives the focus back to the page region that last had it in the window, the page, the split partner or a docked DevTools, while it still shows. Else it goes to the selected tab's page. The module remembers that region from focus events, in memory per window.
- An action that meets a missing or changed Firefox internal leaves the key to Firefox. A start that fails leaves the sidebar keys off and the rest of the module on.

## Liveness

The core's frame script runs in every tab. For the top document it reports the inner window id and whether the focus is in a field. It also counts the keydown listeners of DesertFox's content script, from each listener's sandbox metadata, with no help from the extension. It reports at its start, on DOMContentLoaded, pageshow, 500 ms after load, focusin and focusout. The live mark in the state covers the time before the first report.

## blur_on_load

Like web pages, about:preferences and about:config put the focus in their search box as they open. With the setting `blur_on_load` off (the default), a key there types into the box, as it does on a web page. With it on, the extension adds `blur_on_load: true` to the state. The frame script marks a report whose field the page focused within 1 s of DOMContentLoaded or load, before any key or click reached the page. The core sends a blur back only where it would take a key: the pref, the state, the toolbar switch, private access, normal mode and DesertFox not live. The frame script then blurs the field if that is still true for the same document. The window and the activation rule are those of `blur_load_focus` in `src/content/main.ts`.

## The status bar

`desertfox-statusbar.js` draws one bar under the page area of each browser window, below the tab box and the sidebar. It shows, by the settings `browser_bar_left` and `browser_bar_right`, the mode, the half-typed keys with a typed count, the macro register, the container, the scroll place, the tab place and the address. The setting `browser_bar` and the Firefox pref `desertfox.browser_module.statusbar` (true unless set) turn it off. The pref is the kill switch of the bar alone.

- It is not a feature of the core. It runs in the window itself and never adopts into the sandbox, so a fault in it cannot reach the key path. It reads only that the core is on, and the state the extension writes, as foreign input: it checks the version, the lists and each field of the shown tab again. A state it cannot read draws nothing.
- Text reaches the bar only through `textContent`, and the label of a field is cut and stripped of control characters. A theme color reaches a style only when it is `#` and 3, 4, 6 or 8 hex digits. A name that the bar does not know (a widget, a mode, a container color) is not drawn.
- The bar rewrites the core's hello with `bar: true` while it can draw, and takes the flag out when its pref turns off. It writes no hello of its own, so a missing hello stays missing. The extension then hides the corner badge of the page and sends the per-tab fields (see [host.md](host.md#browser-module)). With the bar off, absent or broken, the badge shows as before.
- Every trigger only marks the bar dirty, and one animation frame draws it. A resize is the one place that reads layout: it gives the width in characters and the height. A narrow bar drops the url, then the container, scroll, tab place, macro register and pending keys, in that order. The mode is never dropped.
- The bar sets `--desertfox-statusbar-height` on the window root to its height with its margins, and to 0 while it is hidden, so a later piece can reserve the space. It hides in fullscreen (Firefox's `inFullscreen`, which F11 and a video share) and while customizing.
- The scroll place comes from a frame script that reports only for pages the extension cannot reach (about: and add-on pages, view-source, the PDF viewer, Reader View). A web page sends no message. It stays in the browser process and is not written to storage.
- The tab, container, address and security parts are read in the browser itself. Reader View shows the address of the page it holds. A private window shows no address and no site label.
- Look: flat, in the colors of Firefox's toolbar, with the mode badge in the theme's mode color. When a TextFox style is present (`--tf-bg`), the bar is one more pane of it: its border, margin, font, hover color and radius. `browser_bar_border` sets the corner. `auto` reads the panes of the window once: a radius above zero is round, a bevel on the navigation bar is a chamfer, and no TextFox variable is square. The bevel is drawn by the bar itself. A Firefox restart is needed for a corner change in the panes, because their style loads at start.
- The bar needs `#browser`. A window without it (a popup) gets no bar. A Firefox release that moves it leaves the corner badge in place, because the bar says nothing in the hello when it cannot build.

## Messages

The core reads the extension's requests and writes its own list (the channel is in [host.md](host.md#browser-module)).

- One storage listener (`extensionStorageSession.registerListener`) per DesertFox extension object, in the core sandbox. A reloaded DesertFox is a new object with an empty bucket, so the core listens to the new one on its `ready` and stops the old listener. Shutting down for the session stops it too.
- Each change of the from-extension list carries the whole list in `newValue`. The core checks it once, as `validate_message_list` does, and never reads it again. A list past 16 messages or the list's byte cap (`message_list_bytes`) is dropped, and a message over its kind's `max_bytes` is refused. A request older than its kind's `max_age_ms` (2000 when absent) is dropped, with an error reply when its kind expects one. A request with no `sent_at` is accepted. Ids already handled, kept per extension object, are skipped.
- A feature file answers a kind with `register_kind(kind, handler)`, for a kind on the core's copy of `EXTENSION_TO_MODULE_KINDS`. The handler gets the checked args and returns `{ ok, error?, value? }` or a promise of it. The reply copies `ok`, the error cut to 120 characters and a text `value`. A reply over the kind's `max_bytes` becomes the error "the answer is too large". A kind no feature answers (`page_push` and `address_bar.open` for now) gets "no handler for this kind". A reply error loses control and bidi characters, as on the extension side. A handler that throws or rejects gives the fixed error "the request failed", never its own text. A push (`reply: false`) gets no reply.
- `send(kind, args)` starts a call to the extension, for a kind on the copy of `MODULE_TO_EXTENSION_KINDS`. It sets `sent_at`. Requests and replies go to the from-module list, the newest within its caps. The core writes nothing there while the pref is off or after DesertFox reloaded, so a reply that settles late goes nowhere.

## Keys on locked pages

Status: the background side is built (`src/shared/browser_module_scope.ts`, `src/background/browser_module_run.ts`). The module's matcher and request writer are not yet built.

Beside the single-key rows, the state carries `tree`: the normal tree pruned to the keys a locked page can run, so the module takes sequences (`gg`, `xx`) and counts too.

- The set is derived, never listed: a command that runs in the background and does not need `content`, minus a deny list (`media.act`, `frame.exit`, `macro.record`, every `mode.*`). A page swaps the record key for `macro.stop` while a macro records, and the stored tree has no such swap, so `q` stays with the page. `test/browser_module_scope.test.ts` lists the result, so a new command shows in review. `docs/keymap.md` marks the keys in its Locked pages column, from the same derivation.
- A leaf stays when every step is in the set and it has no guard. A key that leads only to other leaves is not in the tree, so `f`, `/` and `:` stay with the page or Firefox. Site rules do not apply: a locked page matches none.
- A leaf is `forward` or native. A native leaf is one command of the protocol's list (`tab.next`, the scroll commands) with its args and count rule, which the module runs itself. A forward leaf holds no command id.
- The tree is rewritten with every state write, so a keymap change, the toolbar switch and the setting follow. It is left out when the switch is off and when it is over `MAX_TREE_BYTES` (32 KB). The default tree is about 4 KB. The module then keeps only the single-key rows, as a module that predates the tree does.
- For a forward leaf the module sends a `run` request: the tokens of the path joined by spaces, and the typed count or 0. Chrome sends no tab id. The background matches the tokens again against the stored tree with `create_matcher`, never the module's copy, so a stale or forged tree runs nothing the keymap does not bind now. The tokens must end on a leaf of the set, with no count, register or hold typed among them. The binding then runs through the router in the active tab, in normal mode, with `may_prompt`. The router refuses a count over a step's `repeat_limit` before any step runs, as for a key on a web page.
- A refusal the user caused (a key the keymap no longer binds, a key that needs a page, a count over the limit) shows as a desktop notification, as any refusal with no page does. Junk keys text and a bad count are refused with no notification.
- A key that asks for a value (`o`, `T`) opens the command line through `open_cmdline`. A tab with no content script gets `address_bar.open` instead: the module opens the address bar of the active window with `df ` and the printed command typed in, and the omnibox runs it on Enter. The handoff ends the binding as a line the user left does, so a later step of the binding never runs while the bar is still open. The text is data in an input field, never code or an address to load. A module that cannot answer leaves the refusal "needs a page DesertFox runs on".

## Safety

- Startup: every step at load and per window runs in a `try`. A failure logs one line, turns the module off for the session (all windows lose their listener) and never throws into the loader.
- A Firefox internal that throws on a key leaves that key to the page and logs one line per distinct error.
- With the pref off the module loads no frame script, says no hello and handles no message. It turns on at once when the pref does. Turning the pref off takes the hello back. The frame scripts stay loaded for the session once loaded, so they check the pref and do nothing while it is off. Turning it on again asks each tab for a fresh report.
- The module makes no network request and runs no code it reads. A key row names a command a feature file defines, and a request names a kind on a fixed list, each with checked args. It writes the extension only the hello and the from-module list.

## Tests

- `test/browser_module/` runs the files in `vm` contexts against a stand-in for Firefox (`fake_firefox.ts`). It covers the decision above, the token and protocol copies, the setup once per process, window close, startup failure, blur_on_load and the message reader. The reader tests put test-only rows into the module's copy of the kind lists. It runs `install.sh` in a user namespace.
- Every key-test run uses a private copy of `/usr/lib/firefox` in the run folder (`test/key/firefox_copy.mjs`, passed to `launch_firefox.sh` as `KEY_TEST_FIREFOX`). It holds a test loader (`test/key/chrome_loader.cfg`), this worktree's module files and a drop-in that throws at load before them. So the whole suite runs with the module present and its pref unset, and a module installed on the machine never loads in a test.
- `statusbar_draw.test.ts`, `statusbar_labels.test.ts` and `statusbar_window.ts` run the bar in a fake window with a small DOM. The label test keeps the address, scroll and tab labels equal to the command line's (`src/cmdline/status.ts`). `p54_browser_module_bar` shows the bar in a real window with the hello, the mode, a half-typed key, a locked page's scroll place, the setting off and a private window.
- The `p54_browser_module_*` pieces turn the module on and press real keys. `locked` covers the locked pages, fields, blur_on_load, the commit gap and a refusal through the real message lists. `pages` covers the error pages, a restricted site, the new tab and home pages, view-source, the JSON viewer, about:config, about:support and another extension's page. `private` covers private windows. `gates` covers DevTools, the switches, a version mismatch, a remap and a second window.
- `p56_sidebar_keys` turns the module on, writes a sidebar table into the state and presses real keys in the history and open tabs panels and the vertical strip. `test/browser_module/sidebar.test.ts` covers the decision for each place, each action, the held key and `type_key`.
- `p55_panes` turns the module on and runs the pane keys through the extension's requests: a split with a new tab and with the next tab, unsplit, a refusal, resize, the DevTools focus and close both. `test/browser_module/panes.test.ts` covers each pane call's refusals and missing Firefox internals.
- The restricted site is localhost on `extensions.webextensions.restrictedDomains`. `KEY_TEST_NETWORK=1` also opens the real addons.mozilla.org, support.mozilla.org and accounts.firefox.com.
