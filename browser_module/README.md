# browser_module

The browser module: plain scripts that Firefox loads with browser privileges from `chrome.d` in its install folder. It takes DesertFox's tab and scroll keys on pages a content script misses. Behavior: [docs/design/browser_module.md](../docs/design/browser_module.md). The channel it reads: `src/shared/browser_module_protocol.ts`.

- `desertfox-browser.js`: the core. The state, the hello, the message lists, the guards (fields, DevTools, modes, liveness, private windows), the report frame script and the surface feature files use. Start here.
- `desertfox-tabs-scroll.js`: the tab and scroll feature. It defines `tab.next`, `tab.prev` and the four scroll commands, and holds the scroll frame script.
- `desertfox-panes.js`: the pane feature. It answers the extension's `pane.*` requests (split, unsplit, close both, resize, equal widths, focus a region or a side) in the focused window.
- `desertfox-popup-walk.js`: the popup walk. `j`, `k`, `h` and `l` type arrow keys in open menus and panels and in the Library, Page Info and Picture-in-Picture windows.
- `desertfox-locked-pages.js`: DesertFox's own page code in the PDF viewer and Reader View. It attaches the sandbox, loads the shim, `content.js` and the bundles from the extension, and relays the page's messages unread. Open it for the attach rule or the transport.
- `install.sh`: `sudo browser_module/install.sh [--uninstall]` copies or removes every `desertfox-*.js` file here.

Rules:

- This folder stays outside `src/` and `dist/`, so the xpi never holds it. Nothing in `src/` or `host/` installs, downloads or loads it.
- A new feature is a new `desertfox-<feature>.js` file that sorts after `desertfox-browser.js`. `install.sh` and the key test's Firefox copy (`test/key/firefox_copy.mjs`) take every file of that pattern.
- The core keeps a copy of the protocol's key names, version, limits and kind lists. `test/browser_module/core.test.ts` fails when the copy drifts. A new kind goes in both.
- No network request, no code from storage and no test hook. Tests read `status()`, which holds counts and names only, never page data.

## Manual test notes

- Set `desertfox.browser_module.enabled` to `true` in about:config and turn on the setting `browser_module`, then restart Firefox. The settings page shows the module's hello.
- In a private window the module acts only when DesertFox has private window access (about:addons, DesertFox, "Run in Private Windows"). Without that, J and the scroll keys do nothing on about:privatebrowsing, about:newtab and about:home there. That is intended.
- about:preferences and about:config put the focus in their search box when they open, so J types there. Turn on the setting `blur_on_load` to take the focus out of the box on load, or click the page first.
- In the PDF viewer `j` and `k` scroll and never reach pdf.js, which uses them for the next and previous page.
