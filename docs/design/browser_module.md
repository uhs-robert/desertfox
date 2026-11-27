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
- Each feature is its own file that sorts after the core (`desertfox-tabs-scroll.js` runs `tab.next`, `tab.prev`, `scroll.lines`, `scroll.pixels`, `scroll.pages` and `scroll.to`, `desertfox-panes.js` answers the pane kinds and `desertfox-cmdline-panel.js` opens the command line panel). A later feature adds a file and touches no other.
- `desertfox-commands.js` is generated: `tools/build_browser_module.ts` (`just browser-module`) bundles `browser_module/sources/commands.js` with the extension's matcher (`src/shared/keys/matcher.ts`), token (`src/shared/keys/token.ts`) and tree check, so both sides read keys with one code. The file is committed, because `install.sh` copies the checkout and runs no build. `test/tools/build_browser_module.test.ts` fails when it differs from a fresh build, so a change to the bundled code needs `just browser-module` in the same PR.
- The core lives in a system sandbox that the first window builds by loading the core file into it, once per process. A listener the process keeps then holds no closed window alive. In a window, the core file only attaches the window, and a feature file only asks the core to load it into the sandbox (`adopt`). The core loads only files from its own folder.
- The surface for feature files, on `Services.desertfox_browser_module`: `define_command(id, { args, run })`, `add_frame_script(fn)`, `register_kind(kind, handler)`, `send(kind, args)`, `log_once(text)`, `set_hello_flag(name, on)`, `take_keys(taker)`, `run_command(id, args, context)`, `module_pending(win)`, `take_held_keys(win, end)`, `may_act(win)`, `on_shut_down(fn)`, `sidebar_row(win, keys)`, `token_of(event)`, `type_key(win, key, still_holds)` and, in a window, `adopt(file_url)`. `args` names the shape of each arg (`int`, `number`, `enum` with `values`), and the core runs `run({ window, browser, tab, args, repeat })` only for a row whose args fit. The header of the core file documents it.
- A feature file lets an error in its start throw. The core then turns the module off for the session, so a feature that started halfway never takes keys.

## When the module takes a key

All of these must hold, checked on each keydown in the capture phase of the browser window. Otherwise the key goes on as if the module were not there.

1. The event is trusted, not part of an IME composition and not prevented. The pref is `true`.
2. The key is for a tab's page. A key in the browser UI, DevTools (docked toolbox or any panel), a sidebar or a popup is not. Its document is no content document of a tab browser. So DevTools' own keys keep working.
3. DesertFox is running, and in a private window it has private window access.
4. The state is valid: the right `v`, `enabled` true, unknown fields ignored. The module applies the protocol's limits (32 key rows, 1024 tabs) and checks each field it reads, so a state past them claims nothing. An extension reload empties `storage.session`, so the module takes nothing until the new extension writes the state again.
5. The key's token (the same normalization as `src/shared/keys/token.ts`) has a row whose command a feature defined, with args of the right shape. With the commands feature loaded, the feature decides instead, after checks 6 to 8 (see [Keys on locked pages](#keys-on-locked-pages)).
6. The focus is not in a field. A page in the parent process is read directly: the deep active element, the event's own target and design mode. A remote page is read from its frame script's report. A key can come before the report. The window's input state (`windowUtils.IMEStatus`) covers it, because Firefox sets it when a text field takes the focus.
7. The tab is in normal mode. A tab the state does not list is normal and not live.
8. DesertFox is not live in the shown document. No report for the current inner window counts a DesertFox keydown listener, and the tab has no live mark. A report from an older document of the tab does not count.

The module runs the command first, then prevents and stops the key in the parent, so the page and the content script never see it. A command that throws leaves the key to the page. Tab keys run `advanceSelectedTab`, which wraps. Scroll keys go to the feature's frame script. It scrolls the focused element's scrolling ancestor, else the page when it scrolls. Else it scrolls the largest scrolling box, such as the settings pane of about:preferences or the PDF viewer's pages. In the PDF viewer DesertFox's keys win, so pdf.js loses its own `j` and `k`.

## Browser sidebar keys

`desertfox-sidebar.js` takes keys in Firefox's own sidebar: the vertical tab strip (with `sidebar.verticalTabs` on) and the history, bookmarks and open tabs panels. It never takes a key in another panel, such as an add-on's sidebar, whose page it does not know. It attaches its own keydown listener to each browser window's root, because a key there is not for a page and the core leaves it alone.

- The keys come from `sidebar_keys` in the state, built from the keymap's `sidebar` mode: rows of one or two key tokens, each naming one `sidebar.*` command. A bad table is left out whole, and the other keys stay. The module holds the first key of a two-key row (`gg`) per window. Escape, a focus move or a window blur drops it. Any other key tries the pair, then itself alone.
- A key is taken only with the focus in one of those places, the module allowed to act there (`may_act`) and no menu or walking panel open (the popup walk owns those keys). In a text field, such as a panel's search box (a field in a shadow root included), only the `sidebar.leave` row is taken.
- In a panel the moves, open, expand and collapse type arrow keys, Home, End or Enter through the core's `type_key`, so Firefox keeps its own selection, scrolling and folding. `type_key` types only those keys, after the current key event, and never with the focus in a text field or DevTools. A typed key passes the feature's own listener untouched, so a typed Enter never runs `sidebar.open` again. In the strip they move the strip's own keyboard focus (`ariaFocusedItem`), select the tab or fold its group.
- `sidebar.close_item` closes the open tabs row's tab or the strip's tab. It is not taken in history or bookmarks, where a close would delete data. `sidebar.filter` focuses the panel's search box, and in the strip opens Firefox's all tabs panel.
- `sidebar.leave` (Escape) from the search box goes to the list. Elsewhere it gives the focus back to the page region that last had it in the window, the page, the split partner or a docked DevTools, while it still shows. Else it goes to the selected tab's page. The module remembers that region from focus events, in memory per window.
- An action that meets a missing or changed Firefox internal leaves the key to Firefox. A start that fails leaves the sidebar keys off and the rest of the module on.
- The keys live in the keymap's `sidebar` mode: `j k gg G <Enter> l h d / <Escape>`, each bound to one `sidebar.*` command. The mode never runs in a page. The extension writes its rows into the state (`sidebar_rows_of`) and a user rebinds them like any other mode. A key with a count, a prompt, a guard or more than two tokens is left out of the table.
- The `sidebar.*` commands are defined once in the registry, with command line names such as `sidebar_down`, and hidden from completion. The extension has no focus in the sidebar, so its handler of each refuses with "Works only with focus in the sidebar". Only the module runs them.
- `,e` focuses the sidebar. It is the same `pane.focus` command with region `sidebar` that `ES` runs, and it needs the module. The focus lands in the panel's search box, so a letter types there. The first <Escape> moves into the list, where the keys above work. The next <Escape> goes back to the page. The same holds after `ES`.
- In which-key the `g` group of this mode is the `Go` group of the normal mode. `,e` sits in the `DesertFox` group.

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
- A feature file answers a kind with `register_kind(kind, handler)`, for a kind on the core's copy of `EXTENSION_TO_MODULE_KINDS`. The handler gets the checked args and returns `{ ok, error?, value? }` or a promise of it. The reply copies `ok`, the error cut to 120 characters and a text `value`. A reply over the kind's `max_bytes` becomes the error "the answer is too large". A kind no feature answers gets "no handler for this kind". A reply error loses control and bidi characters, as on the extension side. A handler that throws or rejects gives the fixed error "the request failed", never its own text. A push (`reply: false`) gets no reply.
- `send(kind, args)` starts a call to the extension, for a kind on the copy of `MODULE_TO_EXTENSION_KINDS`. It sets `sent_at`. Requests and replies go to the from-module list, the newest within its caps. The core writes nothing there while the pref is off or after DesertFox reloaded, so a reply that settles late goes nowhere.

## Keys on locked pages

Status: built. The background side is `src/shared/browser_module_scope.ts` and `src/background/browser_module_run.ts`. The module side is `desertfox-commands.js`.

Beside the single-key rows, the state carries `tree`: the normal tree pruned to the keys a locked page can run, so the module takes sequences (`gg`, `xx`) and counts too.

- The set is derived, never listed: a command that runs in the background and does not need `content`, minus a deny list (`media.act`, `frame.exit`, `macro.record`, every `mode.*`). A page swaps the record key for `macro.stop` while a macro records, and the stored tree has no such swap, so `q` stays with the page. `test/browser_module_scope.test.ts` lists the result, so a new command shows in review. `docs/keymap.md` marks the keys in its Locked pages column, from the same derivation.
- A leaf stays when every step is in the set and it has no guard. A bare `cmdline.open` leaf (`:`) stays too, as a forward leaf, because the background opens the line itself (see [The command line panel](#the-command-line-panel)). One that types text in (`A`, `tM`) does not, since its commands mostly need a page. A key that leads only to other leaves is not in the tree, so `f` and `/` stay with the page or Firefox. Site rules do not apply: a locked page matches none.
- A leaf is `forward` or native. A native leaf is one command of the protocol's list (`tab.next`, the scroll commands, `page.stop`) with its args and count rule, which the module runs itself. A forward leaf holds no command id.
- The tree is rewritten with every state write, so a keymap change, the toolbar switch and the setting follow. It is left out when the switch is off and when it is over `MAX_TREE_BYTES` (32 KB). The default tree is about 4 KB. The module then keeps only the single-key rows, as a module that predates the tree does.
- For a forward leaf the module sends a `run` request: the tokens of the path joined by spaces, and the typed count or 0. Chrome sends no tab id. The background matches the tokens again against the stored tree with `create_matcher`, never the module's copy, so a stale or forged tree runs nothing the keymap does not bind now. The tokens must end on a leaf of the set, with no count, register or hold typed among them. The binding then runs through the router in the active tab, in normal mode, with `may_prompt`. The router refuses a count over a step's `repeat_limit` before any step runs, as for a key on a web page.
- A refusal the user caused (a key the keymap no longer binds, a key that needs a page, a count over the limit) shows as a desktop notification, as any refusal with no page does. Junk keys text and a bad count are refused with no notification.
- The module matches with the extension's own matcher against the tree, one matcher per window, in the keydown's tick, so a prefix key (`g`, `x`) and a count digit are stopped before the page sees them. A key that ends no sequence goes to the page. A key on another tab or document, or a new tree, starts a fresh walk, so a half-typed `g` never finishes on another tab. A state rewrite with the same tree keeps the walk. There is no timeout, as in DesertFox's own key flow. A key a guard refuses (a field, a live or non-normal tab, the browser UI or DevTools, no state) ends the walk, and so does the pref or the toolbar switch going off, so a half-typed `x` never finishes after a trip into a field.
- A native leaf runs through `run_command`, with the count as its count rule says. A `repeat` count runs the command at most 100 times.
- A hold Space (a group's hydra hold) needs the which-key panel, so the walk resets and the Space goes to the page. A register typed before a binding (`"a`) means nothing here, so the keys run nothing.
- With no tree, or a tree that fails `validate_scope_tree` (bundled in), the single-key rows decide, as before.
- `module_pending(win)` gives the keys half typed in the window's selected tab and the count, for the status bar. The module never sends them.
- The tree's root lists the forward leaves that open the command line in `line_keys` (`:`, and the keys that ask for a value: `o`, `T`, `ww`). After one of them the module holds every key of that window and runs none, because the line takes a few hundred milliseconds to get the focus and a fast `:undo` would otherwise run `u` on the page. It keeps the printable text typed meanwhile (32 characters at most). The hold ends when the panel shows and takes the focus, when the address bar opens, on a tab switch, when the window loses the focus, on Escape and after 1.5 s. An older module ignores the field and holds nothing.
- The module keeps two keys of its own, because the tree carries no mode leaves and an older extension's tree has no command line leaf: `<S-Escape>` and `:`. Each works only while no sequence is under way and the tree does not bind it, so a user binding wins. `<S-Escape>` follows no remap of DesertFox's own key.
- `<S-Escape>` is the ignore toggle. The module keeps the flag per tab, in memory, for the document it was turned on in, so a load ends it. While it is on, every other key goes to the page, so pdf.js gets its `j` and `k` back.
- `:` opens the address bar with `df `, the backup command line, when the tree has no `:`. A current extension's tree binds it, so the module forwards it like any other leaf and the background opens the panel. With no tree, a single-key row for `:` or `<S-Escape>` wins over the module's own key.
- A key that asks for a value (`o`, `T`) opens the command line through `open_cmdline`. A tab with no content script gets the panel, and when the module refuses it, `address_bar.open` instead: the module opens the address bar of the focused window with `df ` and the printed command typed in, and the omnibox runs it when the user presses Enter. The module never submits it, and it sets the field without starting a query, so the text (which can hold the selection or clipboard text) reaches no search suggestion provider until the user edits it. The request names the tab that asked (`tab_id`), and the module refuses when that tab is no longer the selected tab of the focused window. The handoff ends the binding as a line the user left does, so a later step of the binding never runs while the bar is still open. The text loses control and format characters and is data in an input field, never code or an address to load. A private window counts only with DesertFox's private window access. A module that cannot answer leaves the refusal "needs a page DesertFox runs on".

## The command line panel

Status: built. The module side is `desertfox-cmdline-panel.js`, the background side `src/background/cmdline_panel.ts`, and the page the same `src/cmdline/page.ts` as on web pages.

On a locked page `:` and a key that asks for a value open DesertFox's own command line in a panel over the page. The address bar is the backup.

- The background sends `cmdline_panel.open { tab_id }`. When the module opens the panel, the background records it in `storage.session` (`desertfox_cmdline_panel`): the tab, its window, whether it is private, the mode, the text to type in and the page's address. When the module refuses or has no handler, the background records nothing and sends `address_bar.open`. Opens, the page's claim and every forget run one at a time, so no step deletes or overwrites a record written after it read.
- The module's reply carries, as JSON text, a random key it put in the page's address (`cmdline.html?panel=<key>`) and the keys held since the line was asked for. The background checks both as foreign input and adds the typed text to the line. Keys typed between the reply and the panel taking the focus are dropped. The page focuses its input at once and keeps what lands there before its data arrives.
- The module refuses when the tab is no longer the selected tab of its window, when it may not act there (the pref, private access, the switch), when a panel is already open and when Firefox has no `mainPopupSet`. Otherwise it opens a XUL panel at the bottom of the page, the page's width.
- The panel holds a remote `<browser>` built as Firefox builds a toolbar popup (`ExtensionPopups.sys.mjs`): DesertFox's browsing context group and remote type, `extension-browser-inserted`, Firefox's own popup content script and the fixed address `cmdline.html` with DesertFox's principal as the loader. The page runs in DesertFox's process with DesertFox's principal, never the system principal. The extension names only the tab.
- Traps: the browser joins the panel only on `popupshown`, because a remote browser appended before `openPopup` crashed the parent process. Its message manager exists one microtask after `XULFrameLoaderCreated`.
- The page grows the panel upward with its list: Firefox's popup content script measures the page and sends `Extension:BrowserResized`, and the module sets the height, capped at the page's height, and moves the panel.
- The panel closes on the page's `window.close()`, on a tab switch (`TabSelect`), when its tab loads another page, on Escape and when the module shuts down. The focus then goes back to the page it opened over, if that tab is still selected. A page that failed to load makes the module refuse every later panel in the session, so `:` opens the address bar.
- The record goes when the line ends (Enter, or Escape through `close_panel_cmdline`), when its tab closes or loads, when another tab of its window comes up and when another window or no window takes the focus.
- The page sees it has no parent window and asks `open_panel_cmdline` in place of a ticket. The background answers only its own `cmdline.html` with no sender tab at the recorded address, key included, and only once per record. A copy a web page frames or opens in a tab, a copy another extension frames or a sidebar shows, and the toolbar popup get nothing: Firefox gives a sender with no tab no frame id, so only the key tells the panel's page apart. It then opens the line through the command line service with frame id -1 as the opener, so the opener checks of completion, the tab rows, help and the ports admit the panel and no frame of the tab.
- One helper, `asker_of`, gives every later message of the page the recorded tab: `run`, `record_cmdline` (no history from a private line), `complete_items`, `tab_rows_action`, `open_help` and the tab model and rank ports. A private window's panel loads as a private browsing context, so its line lists private tabs only.
- The page stands in for its host: Enter sends `run` with `from_line` and closes the window, a close closes the window, and the line has no page search.
- The module's keys stay out of the panel: its browser is no tab browser, so the core's key guard leaves every key there to the page.

## Page code on locked pages

Status: built, off by default. The module side is `desertfox-locked-pages.js`. The extension side is `src/content/locked_shim.ts` and `src/background/browser_module_rpc.ts`. The kinds and snapshots are in `src/shared/browser_module_protocol.ts`. What Firefox does there is measured in [firefox-behavior.md](../firefox-behavior.md#locked-pages-locked-page-modes).

With the setting `browser_module_pages` on, DesertFox's own `content.js` and bundles run inside the PDF viewer and Reader View, so every key that works on a web page works there too (hints, caret, which-key, the command line). The module's key tree (above) still covers about:addons, about:preferences and every other locked page.

What runs where:

- In the extension: the background answers each page call through the same router as a content script's message. It refuses a type the route table (`LOCKED_PAGE_ROUTES`) does not list for a locked page, such as snippets.
- In the module core: the attach rule, the calls and pushes, and the snapshots. Chrome code never parses a page message.
- In the page's process, a sandbox: `locked_shim.js` (the `browser` global, a typed surface over the module's transport), then `content.js`, then bundles. The module loads files only by name from a fixed list.

Trust boundary and principal:

- The sandbox runs under the expanded principal `[page, extension]`, as Firefox gives a content script on a web page. It never runs under the system principal, so the feature adds no privilege over a content script. For this reason about:addons and about:preferences are out of scope: they work only under the system principal.
- A page script sees nothing of the sandbox. The transport sits on the sandbox global, not on the page window.
- Chrome relays the JSON text of a page message as it came. The extension reads it, checks it against the route table and a size cap, and answers. The shim checks the same list, but the background never trusts it. `tab_id` and `document_id` are facts chrome reads, never fields of the page's message.

Channel kinds (all JSON text with a size limit and an age limit, in both kind tables):

- `page_call`, from the module: a page message for the background, with a reply.
- `page_push`, to the module: a background message for the page, in place of `tabs.sendMessage`, with a reply. A push settles when the page answers or its attach ends.
- `page_gone`, from the module: chrome says an attach ended, on pagehide and when the page's window goes away. The background marks a document left only on this word. A same-address load event does not end a lock, because the PDF viewer sends a second one with no new document.

Both calls name a `document_id`, one id per attach, so a call from a document that a load replaced is refused. A page that Back restores from the cache attaches again under a new id.

Snapshots carry the read-only data a message is too small for: the keymap with its site rules, the config status, the theme and the which-key panel of normal mode. The extension writes one session storage key per part with its own cap and rewrites it when the part changes. The module checks each part once (`validate_snapshot`) and hands the shim a copy. A missing, invalid or over-cap keymap or config snapshot leaves the page code stopped and the module keys in force. Site rules on a locked page match the tab's address, which the background reads.

Lifecycle:

- The module attaches a page only when the kill switch pref, `browser_module` and `browser_module_pages` are on, the snapshots are present with protocol version 1, the tab is not private (unless DesertFox has private access), and chrome reads the page kind as the PDF viewer or Reader View.
- Pagehide destroys the sandbox and settles every open call and push with an error. Turning either setting off, the kill switch, a version mismatch or a failed start does the same and takes the page code out. Tab close clears the tab's lock.
- The setting is off by default and works only with `browser_module` on. [privacy.md](../privacy.md) states what it writes and relays.

## Safety

- Startup: every step at load and per window runs in a `try`. A failure logs one line, turns the module off for the session (all windows lose their listener) and never throws into the loader.
- A Firefox internal that throws on a key leaves that key to the page and logs one line per distinct error.
- With the pref off the module loads no frame script, says no hello and handles no message. It turns on at once when the pref does. Turning the pref off takes the hello back. The frame scripts stay loaded for the session once loaded, so they check the pref and do nothing while it is off. Turning it on again asks each tab for a fresh report.
- The module makes no network request and runs no code it reads. A key row or tree leaf names a command a feature file defines, and a request names a kind on a fixed list, each with checked args. It writes the extension only the hello and the from-module list. The hello has one writer, the core: a feature sets a flag on its fixed list (`bar`) with `set_hello_flag`.
- A finished match is the only key data the module sends: the tokens of a forward leaf and the count, never raw key events or the keys of an unfinished sequence. The one exception is the text held after a key that opens the command line (at most 32 characters), which goes to the line in the `cmdline_panel.open` reply or into the address bar.

## Tests

- `test/browser_module/` runs the files in `vm` contexts against a stand-in for Firefox (`fake_firefox.ts`). It covers the decision above, the token and protocol copies, the commands feature (`commands.test.ts`, on the committed bundle), the setup once per process, window close, startup failure, blur_on_load and the message reader. The reader tests put test-only rows into the module's copy of the kind lists. It runs `install.sh` in a user namespace.
- Every key-test run uses a private copy of `/usr/lib/firefox` in the run folder (`test/key/firefox_copy.mjs`, passed to `launch_firefox.sh` as `KEY_TEST_FIREFOX`). It holds a test loader (`test/key/chrome_loader.cfg`), this worktree's module files and a drop-in that throws at load before them. So the whole suite runs with the module present and its pref unset, and a module installed on the machine never loads in a test.
- `statusbar_draw.test.ts`, `statusbar_labels.test.ts` and `statusbar_window.ts` run the bar in a fake window with a small DOM. The label test keeps the address, scroll and tab labels equal to the command line's (`src/cmdline/status.ts`). `p54_browser_module_bar` shows the bar in a real window with the hello, the mode, a half-typed key, a locked page's scroll place, the setting off and a private window.
- The `p54_browser_module_*` pieces turn the module on and press real keys. `locked` covers the locked pages, fields, blur_on_load, the commit gap and a refusal through the real message lists. `pages` covers the error pages, a restricted site, the new tab and home pages, view-source, the JSON viewer, about:config, about:support and another extension's page. `private` covers private windows. `gates` covers DevTools, the switches, a version mismatch, a remap and a second window.
- `p54_browser_module_cmdline_panel` covers the panel on about:preferences: Enter, Escape and the focus, a tab switch, the module's keys inside it, `:u` and `:xx` typed before the line has the focus, a prompt key, the address bar when the module refuses, a private window and a closed tab. `test/browser_module/cmdline_panel.test.ts` and `test/background/cmdline_panel.test.ts` cover the refusals, the build of the browser and the background's gate.
- `p56_sidebar_keys` turns the module on, waits for the sidebar table the extension builds from the default keymap and presses real keys in the history and open tabs panels and the vertical strip. `test/browser_module/sidebar.test.ts` covers the decision for each place, each action, the held key and `type_key`.
- `p55_panes` turns the module on and runs the pane keys through the extension's requests: a split with a new tab and with the next tab, unsplit, a refusal, resize, the DevTools focus and close both. `test/browser_module/panes.test.ts` covers each pane call's refusals and missing Firefox internals.
- The restricted site is localhost on `extensions.webextensions.restrictedDomains`. `KEY_TEST_NETWORK=1` also opens the real addons.mozilla.org, support.mozilla.org and accounts.firefox.com.
