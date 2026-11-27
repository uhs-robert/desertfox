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
- Each feature is its own file that sorts after the core (`desertfox-tabs-scroll.js` runs `tab.next`, `tab.prev`, `scroll.lines`, `scroll.pixels`, `scroll.pages` and `scroll.to`, and `desertfox-panes.js` answers the pane kinds). A later feature adds a file and touches no other.
- The core lives in a system sandbox that the first window builds by loading the core file into it, once per process. A listener the process keeps then holds no closed window alive. In a window, the core file only attaches the window, and a feature file only asks the core to load it into the sandbox (`adopt`). The core loads only files from its own folder.
- The surface for feature files, on `Services.desertfox_browser_module`: `define_command(id, { args, run })`, `add_frame_script(fn)`, `register_kind(kind, handler)`, `send(kind, args)`, `log_once(text)` and, in a window, `adopt(file_url)`. `args` names the shape of each arg (`int`, `number`, `enum` with `values`), and the core runs `run({ window, browser, tab, args, repeat })` only for a row whose args fit. The header of the core file documents it.
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

## Liveness

The core's frame script runs in every tab. For the top document it reports the inner window id and whether the focus is in a field. It also counts the keydown listeners of DesertFox's content script, from each listener's sandbox metadata, with no help from the extension. It reports at its start, on DOMContentLoaded, pageshow, 500 ms after load, focusin and focusout. The live mark in the state covers the time before the first report.

## blur_on_load

Like web pages, about:preferences and about:config put the focus in their search box as they open. With the setting `blur_on_load` off (the default), a key there types into the box, as it does on a web page. With it on, the extension adds `blur_on_load: true` to the state. The frame script marks a report whose field the page focused within 1 s of DOMContentLoaded or load, before any key or click reached the page. The core sends a blur back only where it would take a key: the pref, the state, the toolbar switch, private access, normal mode and DesertFox not live. The frame script then blurs the field if that is still true for the same document. The window and the activation rule are those of `blur_load_focus` in `src/content/main.ts`.

## Messages

The core reads the extension's requests and writes its own list (the channel is in [host.md](host.md#browser-module)).

- One storage listener (`extensionStorageSession.registerListener`) per DesertFox extension object, in the core sandbox. A reloaded DesertFox is a new object with an empty bucket, so the core listens to the new one on its `ready` and stops the old listener. Shutting down for the session stops it too.
- Each change of the from-extension list carries the whole list in `newValue`. The core checks it once, as `validate_message_list` does, and never reads it again. A list past 16 messages or the list's byte cap (`message_list_bytes`) is dropped, and a message over its kind's `max_bytes` is refused. A request older than its kind's `max_age_ms` (2000 when absent) is dropped, with an error reply when its kind expects one. A request with no `sent_at` is accepted. Ids already handled, kept per extension object, are skipped.
- A feature file answers a kind with `register_kind(kind, handler)`, for a kind on the core's copy of `EXTENSION_TO_MODULE_KINDS`. The handler gets the checked args and returns `{ ok, error?, value? }` or a promise of it. The reply copies `ok`, the error cut to 120 characters and a text `value`. A reply over the kind's `max_bytes` becomes the error "the answer is too large". A kind no feature answers (`page_push` for now) gets "no handler for this kind". A reply error loses control and bidi characters, as on the extension side. A handler that throws or rejects gives the fixed error "the request failed", never its own text. A push (`reply: false`) gets no reply.
- `send(kind, args)` starts a call to the extension, for a kind on the copy of `MODULE_TO_EXTENSION_KINDS`. It sets `sent_at`. Requests and replies go to the from-module list, the newest within its caps. The core writes nothing there while the pref is off or after DesertFox reloaded, so a reply that settles late goes nowhere.

## Safety

- Startup: every step at load and per window runs in a `try`. A failure logs one line, turns the module off for the session (all windows lose their listener) and never throws into the loader.
- A Firefox internal that throws on a key leaves that key to the page and logs one line per distinct error.
- With the pref off the module loads no frame script, says no hello and handles no message. It turns on at once when the pref does. Turning the pref off takes the hello back. The frame scripts stay loaded for the session once loaded, so they check the pref and do nothing while it is off. Turning it on again asks each tab for a fresh report.
- The module makes no network request and runs no code it reads. A key row names a command a feature file defines, and a request names a kind on a fixed list, each with checked args. It writes the extension only the hello and the from-module list.

## Tests

- `test/browser_module/` runs the files in `vm` contexts against a stand-in for Firefox (`fake_firefox.ts`). It covers the decision above, the token and protocol copies, the setup once per process, window close, startup failure, blur_on_load and the message reader. The reader tests put test-only rows into the module's copy of the kind lists. It runs `install.sh` in a user namespace.
- Every key-test run uses a private copy of `/usr/lib/firefox` in the run folder (`test/key/firefox_copy.mjs`, passed to `launch_firefox.sh` as `KEY_TEST_FIREFOX`). It holds a test loader (`test/key/chrome_loader.cfg`), this worktree's module files and a drop-in that throws at load before them. So the whole suite runs with the module present and its pref unset, and a module installed on the machine never loads in a test.
- The `p54_browser_module_*` pieces turn the module on and press real keys. `locked` covers the locked pages, fields, blur_on_load, the commit gap and a refusal through the real message lists. `pages` covers the error pages, a restricted site, the new tab and home pages, view-source, the JSON viewer, about:config, about:support and another extension's page. `private` covers private windows. `gates` covers DevTools, the switches, a version mismatch, a remap and a second window.
- `p55_panes` turns the module on and runs the pane keys through the extension's requests: a split with a new tab and with the next tab, unsplit, a refusal, resize, the DevTools focus and close both. `test/browser_module/panes.test.ts` covers each pane call's refusals and missing Firefox internals.
- The restricted site is localhost on `extensions.webextensions.restrictedDomains`. `KEY_TEST_NETWORK=1` also opens the real addons.mozilla.org, support.mozilla.org and accounts.firefox.com.
