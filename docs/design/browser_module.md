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

- `desertfox-browser.js` is the core. It reads and checks the state and says the hello. It decides whether a key is DesertFox's to take on this page. Its frame script reports each document.
- Each feature is its own file that sorts after the core (`desertfox-tabs-scroll.js` runs `tab.next`, `tab.prev`, `scroll.lines`, `scroll.pixels`, `scroll.pages` and `scroll.to`). A later feature adds a file and touches no other.
- The core lives in a system sandbox that the first window builds by loading the core file into it, once per process. A listener the process keeps then holds no closed window alive. In a window, the core file only attaches the window, and a feature file only asks the core to load it into the sandbox (`adopt`). The core loads only files from its own folder.
- The surface for feature files, on `Services.desertfox_browser_module`: `define_command(id, { args, run })`, `add_frame_script(fn)`, `log_once(text)` and, in a window, `adopt(file_url)`. `args` names the shape of each arg (`int`, `number`, `enum` with `values`), and the core runs `run({ window, browser, tab, args, repeat })` only for a row whose args fit. The header of the core file documents it.

## When the module takes a key

All of these must hold, checked on each keydown in the capture phase of the browser window. Otherwise the key goes on as if the module were not there.

1. The event is trusted, not part of an IME composition and not prevented. The pref is `true`.
2. The key is for a tab's page. A key in the browser UI, DevTools (docked toolbox or any panel), a sidebar or a popup is not. Its document is no content document of a tab browser. So DevTools' own keys keep working.
3. DesertFox is running, and in a private window it has private window access.
4. The state is valid: the right `v`, `enabled` true, unknown fields ignored. An extension reload empties `storage.session`, so the module takes nothing until the new extension writes the state again.
5. The key's token (the same normalization as `src/shared/keys/token.ts`) has a row whose command a feature defined, with args of the right shape.
6. The focus is not in a field. A page in the parent process is read directly: the deep active element, the event's own target and design mode. A remote page is read from its frame script's report. A key can come before the report. The window's input state (`windowUtils.IMEStatus`) covers it, because Firefox sets it when a text field takes the focus.
7. The tab is in normal mode. A tab the state does not list is normal and not live.
8. DesertFox is not live in the shown document. No report for the current inner window counts a DesertFox keydown listener, and the tab has no live mark. A report from an older document of the tab does not count.

A taken key is prevented and stopped in the parent, so the page and the content script never see it. Tab keys run `advanceSelectedTab`, which wraps. Scroll keys go to the feature's frame script. It scrolls the focused element's scrolling ancestor, else the page when it scrolls. Else it scrolls the largest scrolling box, such as the settings pane of about:preferences or the PDF viewer's pages. In the PDF viewer DesertFox's keys win, so pdf.js loses its own `j` and `k`.

## Liveness

The core's frame script runs in every tab. For the top document it reports the inner window id and whether the focus is in a field. It also counts the keydown listeners of DesertFox's content script, from each listener's sandbox metadata, with no help from the extension. It reports at its start, on DOMContentLoaded, pageshow, 500 ms after load, focusin and focusout. The live mark in the state covers the time before the first report.

## Safety

- Startup: every step at load and per window runs in a `try`. A failure logs one line, turns the module off for the session (all windows lose their listener) and never throws into the loader.
- A Firefox internal that throws on a key leaves that key to the page and logs one line per distinct error.
- With the pref off the module loads no frame script and says no hello. It turns on at once when the pref does. Turning the pref off takes the hello back.
- The module makes no network request and runs no code it reads. A key row names a command a feature file defines, with checked args. It sends the extension only the hello.

## Tests

- `test/browser_module/` runs the files in `vm` contexts against a stand-in for Firefox (`fake_firefox.ts`). It covers the decision above, the token and protocol copies, the setup once per process, window close and startup failure. It runs `install.sh` in a user namespace.
- Every key-test run uses a private copy of `/usr/lib/firefox` in the run folder (`test/key/firefox_copy.mjs`, passed to `launch_firefox.sh` as `KEY_TEST_FIREFOX`). It holds a test loader (`test/key/chrome_loader.cfg`), this worktree's module files and a drop-in that throws at load before them. So the whole suite runs with the module present and its pref unset, and a module installed on the machine never loads in a test.
- The `p54_browser_module_*` pieces turn the module on and press real keys. `locked` covers the locked pages, fields and the commit gap. `pages` covers the error pages, a restricted site, the new tab and home pages, view-source, the JSON viewer, about:config, about:support and another extension's page. `private` covers private windows. `gates` covers DevTools, the switches, a version mismatch, a remap and a second window.
- The restricted site is localhost on `extensions.webextensions.restrictedDomains`. `KEY_TEST_NETWORK=1` also opens the real addons.mozilla.org, support.mozilla.org and accounts.firefox.com.
