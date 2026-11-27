# DesertFox design

DesertFox is a keyboard-first Firefox extension. It has a small scope and one command registry. Every command is defined once. Keys, the command line, completion, help, the palette and which-key all read that definition.

The extension works on its own. Oasis Dots adds an optional native host. Through it, a desktop shell can show the mode, list the commands and run them.

The measurements this design rests on are in [firefox-behavior.md](firefox-behavior.md). [keymap.md](keymap.md) maps every binding in the current browser config to a command here.

## Where each area lives

This file holds the constraints, decisions, snippets, routing, the content script size rule, release channels, scope, trade-offs, risks and open work. Each area below has its own file under `docs/design/`. A moved section keeps its title here with a pointer.

| Area | File |
| --- | --- |
| The command registry | [design/registry.md](design/registry.md) |
| Keys and modes | [design/keys.md](design/keys.md) |
| The config files, settings, styles, themes and the site table | [design/config.md](design/config.md) |
| How config reaches the browser and saved edits | [design/config_delivery.md](design/config_delivery.md) |
| Bundles and loading | [design/bundles.md](design/bundles.md) |
| The command line, completion and invocations | [design/interfaces_cmdline.md](design/interfaces_cmdline.md) |
| Hints, grab and actions | [design/interfaces_hints.md](design/interfaces_hints.md) |
| Media keys and media mode | [design/interfaces_media.md](design/interfaces_media.md) |
| Caret, search, registers, macros, marks and finder | [design/interfaces_caret_search_marks.md](design/interfaces_caret_search_marks.md) |
| Which-key, help, new tab, popup and external editor | [design/interfaces_pages.md](design/interfaces_pages.md) |
| Tab sessions, groups, split view, live model, unload and reload | [design/interfaces_tabs.md](design/interfaces_tabs.md) |
| The native host | [design/host.md](design/host.md) |
| The browser module, the optional script for the pages a content script misses | [design/browser_module.md](design/browser_module.md) |

## Constraints from Firefox

These were measured on Firefox 159 with real key presses. They shape every choice below.

- A content script catches plain keys such as `Shift+J` on web pages only. It catches nothing on about: pages, addons.mozilla.org, view-source, reader view, the PDF viewer, or while the address bar has focus. The address bar keyword `df` runs commands on these pages (see [Command line and completion](design/interfaces_cmdline.md#command-line-and-completion)). The optional browser module takes the tab and scroll keys there (see [design/browser_module.md](design/browser_module.md)).
- `moz-extension://` pages do not match `<all_urls>`, so no content script runs on them by itself. The help page loads `content.js` with a script tag, and `tabs.sendMessage` reaches it like any other tab.
- The `commands` API (Firefox shortcuts) catches a modifier chord such as `Alt+J` everywhere except on a page that cancels the key first. Firefox rejects bare keys and Shift plus a letter there.
- A `document_start` listener is ready 11-58 ms (median 27) after the first byte of a page. Keys before that moment are lost. Navigating from a live page keeps the old listener until the new page commits.
- A message from a content script to the background and back takes under 1 ms. So does a round trip to a native host over an open port.
- Firefox still supports Manifest V2 with a persistent background page. MV3 in Firefox uses event pages that sleep after 30 s.

## Decisions

- Manifest V2 with a persistent background page. No state lives only in memory, so a later move to MV3 changes the manifest and little else. A copy of stored state may sit in memory when it refills from storage and drops on `storage.onChanged` (the compiled keymap, `keymap_source.ts`).
- TypeScript, bundled with esbuild. No framework. No runtime dependency in the content script.
- No Rust and no WASM. The slow parts are DOM work and messages between processes, not computation. WASM also adds load cost to every page.
- No ex-command language. The command line parses text into the same typed invocation that a key produces. Snippets are the only user code. They come from the user's own config folder, or from an import the user accepts snippet by snippet.
- No shell access. The native host has a fixed set of verbs.
- Native tab groups and the parked sidebar stay separate layers. A native group is the user's own, named and collapsed by keys. The sidebar groups tabs by site on its own, and a sidebar, not yet built, shows `group_id` only as a badge.

## Registry

Moved to [design/registry.md](design/registry.md).

## Invocations and prompts

Moved to [design/interfaces_cmdline.md](design/interfaces_cmdline.md).

## Keys and modes

Moved to [design/keys.md](design/keys.md).

## Config

Moved to [design/config.md](design/config.md).

## Snippets

A snippet is a user command written as page code. It is how users add behavior that DesertFox does not ship, for example helpers for one private web app. DesertFox has no plugin system: snippets are the only extension point.

A snippet file has a header with the command fields, then the code:

```js
// id: myapp.toggle_ids
// label: Toggle IDs
// intent: Show or hide record IDs in My App.
// matches: https://app.example.com/*
// name: ids
// modes: normal, visual
// param: query string main default=selection
// param: all bool short=a
window.wrappedJSObject.my_app.toggle_ids(args.query);
```

- `default=selection` reads a context source. `default=selection,search_query` is a chain: the selection, else the query of the results page. `short=` gives a bool or a valued param its flag letter (`short=a`). An enum maps values to letters: `short=tab:t,window:w`. The letter rules are the define-time checks above.
- `modes` is optional. It lists the modes where a key can run the snippet, from `normal`, `caret`, `visual` and `visual_line`. The default is `normal`. Any other name is a build-config error.
- `tools/build-config` turns the header into a normal registry entry. Snippet commands get keys, which-key rows, help, completion and prompts (through an explicit `prompt`) the same as built-in commands.
- The router checks args, then runs the code in the tab's content script with `tabs.executeScript`, with `args` defined. `window.wrappedJSObject` reaches the page's own functions.
- `matches` limits where the command runs. On other pages the router refuses with a message.
- Errors from the code are caught and shown as a message, with the snippet id.
- Snippets have no storage of their own. The code runs in the content script world, so the body's scope hides `browser` and `chrome`. That guards against accidents and is not a sandbox: `globalThis.browser` still reaches the extension APIs, and the code is the user's own.
- A snippet runs other commands with `desertfox.run(command_text)`, which takes the same text as the command line, for example `await desertfox.run("open -t https://example.com")`. It rejects when the command fails. Snippets can call snippets up to 5 levels deep.
- A relative URL in `fetch` resolves against the extension, not the page. Build the address from `location.origin`, for example `fetch(location.origin + "/api/items")`.
- Snippet ids cannot use a group name that DesertFox uses.

The config file is code, so whoever can write it can run code on pages. The file lives in the user's home directory and only the user's own tools write it, so this adds no new access. An import through the settings page shows each snippet's code, `matches` and `requires`, and stores only the snippets the user accepts. Its consent screen says a snippet can use every DesertFox permission. CSS that loads a remote address is refused on an import, a reload and a save, and the consent views show no user CSS. The import asks on every import and remembers no trust.

## Routing

1. The content script catches a trusted `keydown` in the capture phase on `window`, at `document_start`.
2. It walks the prefix tree for the current mode. On a match it cancels the key and its keypress and keyup. It also cancels a trusted keyup whose keydown this frame never saw, so a page never acts on half a press that began in another frame or in the browser's own UI. This rule runs in normal, insert and the other modes. In ignore mode, on a site that is off and with DesertFox switched off, a lone keyup passes, but a key whose keydown was cancelled still swallows its keyup.
3. It runs a `content` command itself. It sends a `background` command to the background page.
4. The background resolves context sources, checks args and runs the handler. Tab commands act on the tab that is active when they run, never on the tab that was active when the key arrived.

A Firefox shortcut enters at step 4 through `commands.onCommand`.

Every command that opens an address checks it against one allow-list, `openable_url` in `src/shared/url_build.ts`: http, https, ftp, mailto, tel, magnet, `about:blank`, `view-source:` of an http or https address, and DesertFox's own `moz-extension:` pages. Typed text, hints, the clipboard, bookmarks, quickmarks, history and session restore all pass it. Text that names an address off the list is refused, not searched. A request from a page's content script carries `from_page` in its command context, and typed text in it may not open DesertFox's own pages, nor may clipboard or register text from any sender, so a link a page offers cannot reach the grant panel of the help page. Config and stored addresses, such as `home_page` and quickmarks, may open them.

`.` (`command.repeat`) replays the last request that ran to the end. Every finished request or leaf passes `record_step` (`src/background/record_step.ts`), which stores the repeatable steps in `storage.session` when every step succeeded, with the count it had. The router calls it for background commands and for replays, before it answers. The content script calls it, through a `record_step` message, when a leaf of content commands ends, so `j` then `.` scrolls again. A held key sends its first press only. The background checks the message like any page message: content commands only, args through the one validator, at most 16 steps. A failed, cancelled, prompted or `skip_repeat` request never overwrites the slot. A private window has a slot of its own, which Firefox's own rule for private data clears: the background clears it when the last private window closes. A `.` that follows a page record waits for the write. A request that opens the command line stores nothing until the typed command runs. A hint start records itself from the `hints` bundle at the pick start, because a pick that opens the link in this tab can end the page before the leaf ends. So `.` after a hint pick shows hints again with the same action and filter. `3.` replaces the stored count and `.` keeps it. With nothing stored, `.` shows "Nothing to repeat". A pick that opens a link runs as `open.url` marked `from_hints`, which the router does not store, so `.` shows hints and does not reopen the address. A replay re-reads context sources such as the selection and the clipboard, so it uses their values at that time.

Typed text repeats too. A lazy recorder (the `text` bundle) builds one insert session from `input` events: the text typed in one field, never in a secret field (`is_secret_field`: a password input, an autocomplete of `current-password`, `new-password`, `one-time-code` or any `cc-*` token, and a field that was once one). The session ends on Escape, on focusout, on page hide and before any command is sent from the field, so the text is stored before that command. It is stored as a `text.insert` step through the same `record_step` message, led by the command that focused the field (`gi`, `]i`, `[i`, a hint pick on a field) when there was one. `.` runs the entry, then types the text through one field writer; a field focused by a click has no entry, and the replay types into the field the last Escape left, or refuses with "No text field to type into". `3.` types the text three times. The text stays in `storage.session`, in the slot of the window it was typed in.

The content script must have the keymap before the first key. At start it sends `read_keymap` to the background, which reads the compiled prefix tree from `storage.local`, trims it for the page's site rule and replies with the tree as a JSON string. The page keeps every key until the reply arrives, then replays them against the trimmed tree. A held key that the tree leaves unbound goes back to the page as a synthetic keydown on the element it was pressed on, so page scripts see it, and a keyup follows when the real one was already swallowed. Its default action (scroll, Tab focus) is lost, and so is the key when its element has left the page. A rejected ask (the background has not registered its listener yet) is retried every 100 ms, up to 30 asks in all, and then the page installs an empty tree. The next `tree_updated` asks again and heals it. An ask answered after a newer one started is dropped. The old direct storage read took 6-10 ms (median 8). The ask through the background keeps the median under 12 ms (see [firefox-behavior.md](firefox-behavior.md), "Phase 1 measurements").

## Bundles and loading

Moved to [design/bundles.md](design/bundles.md).

### Content script size

`content.js` loads in every frame of every page, so its size has two numbers and one admission rule. The measurements behind them are in [firefox-behavior.md](firefox-behavior.md), "content.js size".

#### Admission rule

Code goes in `content.js` only if one of these holds:

- A. It runs before the first key or decides what happens to a key: the capture listeners, the matcher, modes, focus tracking, the blur-on-load window, held-key replay.
- B. It serves a key that is pressed on most pages in most frames, so a lazy load saves nothing and adds a round trip to nearly every page: scrolling.
- C. The bundles cannot load without it: the bundle host and the proxies that queue calls.
- D. It must work while the page navigates, when Firefox can leave a bundle injection unanswered until the loader times out: `xp` (`page.stop`) and `<A-,>` (`focus_page`). Both matter most on a page that is still loading, so a bundle would fail them where they are needed. A command that only needs a loaded page does not qualify.

Everything else goes in an on-demand bundle. The price of a bundle is a first use that is 11 to 16 ms slower, once per frame. A second test for code admitted under A or B: keep only the part that must be instant. A rare branch of an instant feature goes behind the bundle host.

#### Two numbers

- Guard: 23 KB (23552 bytes). A step past it fails the build and someone has to decide.
- Ceiling: 32 KB (32768 bytes). The guard never passes it, and the build fails when the guard is set above it. Passing it needs the maintainer's decision and a fresh run of the measurements in `tools/measure/` on the Firefox of that day.

The reason for 32 KB: size does not delay the first key below about 64 KB. Probe runs at 0, 4, 16, 32 and 64 KB mostly put the key listener 5 to 7 ms after the response starts. A few runs were slower (54.5, 17.3 and 11.8 ms) and did not repeat in the second pass. What size costs below 64 KB is memory, about 2.4 KB of heap per KB of script in every frame, including frames that never start DesertFox. At 32 KB that is about 8 MB for a typical session (about 100 frames) and 31 MB for a heavy one (about 400 frames). The frame counts are estimates, not measurements. The ceiling sits at half the point where timing starts to count, and it keeps the memory cost bounded.

#### When the guard may rise

1. The new code passes the admission rule, and the commit says which clause.
2. Code that fails the rule has been moved out first. A raise is the last step, not the first.
3. The raise is the smallest step of 512 bytes that fits the feature.
4. The commit that raises it names the feature that needs the room.
5. The guard never passes the ceiling.

## Interfaces

Interface behavior is in six files: [command line](design/interfaces_cmdline.md), [hints](design/interfaces_hints.md), [media](design/interfaces_media.md), [caret, search and marks](design/interfaces_caret_search_marks.md), [pages and panels](design/interfaces_pages.md) and [tabs](design/interfaces_tabs.md).

## Native host (optional)

Moved to [design/host.md](design/host.md).

## Release channels

Two channels exist, stable and beta. The `update_url` in the installed build's manifest decides which one a copy follows. A stable build has none and updates from AMO. Every stable version (`x.y.z`) is a listed AMO version, and `just release` submits it with the notes of `RELEASE.md` converted to plain text. No unlisted xpi is signed for it. An xpi on the GitHub release comes from AMO after Mozilla approves, so it has no `update_url` either (see `amo/README.md`). A beta build points at `updates.json`.

- Stable release order. `just release` publishes the GitHub release with the hosts first, because the add-on's install command points at it, then submits the listed version, then resets `RELEASE.md`. A failed submit leaves the notes in place for `just sign_listed` (recovery steps in `amo/README.md`).
- Versions. Betas are `x.y.z.N`, where N counts builds after the stable `x.y.z` (see [Host updates](design/host.md#host-updates-built)). `.github/workflows/beta.yml` builds one nightly from `main`.
- Update feed. `updates.json` sits on the fixed `beta-channel` release tag and lists only the latest beta. Its `update_link` and `update_hash` point at the signed xpi on that beta's own release.
- Trust. The maintainer's AMO key sits in the `beta-signing` environment, and only the sign job sees it. The other jobs build and publish from the signed output.
- Moving from a beta to a lower stable build. The host keeps the newer one, because it never downgrades. Use the stable build from AMO only after it passes the beta.
- Policy pin. `tools/install_policy.sh beta` pins the fixed URL `beta-channel/desertfox-beta.xpi` in the policy file. The beta workflow replaces that asset on each build, so the prune never deletes the pinned file. The pin only seeds the first install: the `update_url` carries every update after that. The stable pin is a `file://` URL to the local xpi, and it replaces a beta whenever the local xpi ranks higher, so it is not for a beta machine.
- Manual beta. `just beta` starts the beta workflow on `main` and watches the run. `just release` starts no beta, because it pushes the bump to a release branch and main still has the old version. After the release PR merges, the nightly builds the matching `x.y.z.N` beta because main changed. Run `just beta` to get it at once. `just release` installs nothing, so it never replaces a beta pin. Go back to stable with `bash tools/install_policy.sh stable` once the approved stable version is in `web-ext-artifacts/`.
- Local installs. On a beta machine, never run `just install`. It overwrites the beta with a local build.

## Scope

| Status | Contents |
| --- | --- |
| Built | Snippets and `config.reload`, with a managed storage config (since removed) and `tools/build-config`. Normal, insert and ignore modes. Scrolling, back and forward, reload, stop, home, parent and root URL. Tab and window commands, including containers and closed-tab undo. Search engines and explicit prompts. Bookmarks. Hints with every action above, rapid mode included. Copying the URL in 6 formats. Zoom. Search engines with slots and children replace the former site commands (site search, GitHub, subreddit, archive, isdown, translate), which now ship as examples. The listed addons.mozilla.org release: the listing fields and reviewer notes (`amo/metadata.json`), the privacy policy (`docs/privacy.md`), the source archive and its build steps (`just source_archive`, `BUILD.md`), the listed submit (`just release`, or `just sign_listed` to resume it) with the release notes converted from `RELEASE.md` (`tools/amo_notes.mjs`) and the optional `locationInfo` consent for the weather card. The submission, Mozilla's review and the public listing happen on addons.mozilla.org, so this doc does not track their state. `amo/README.md` holds the steps. |
| Dropped | Shell access, string eval, command strings with chaining and pipes, a config language, userChrome editing, rewriting Firefox prefs, page-event hooks, a mode that captures every key for a site (not the grab mode, which moves a dragged element), a theme engine, an update nag, an interactive walkthrough in Quick Start (the Practice page holds hands-on lessons), joke commands, a QR code of the URL and view source. |

## Trade-offs

| Choice | Picked | Cost |
| --- | --- | --- |
| MV2 persistent vs MV3 event page | MV2 | Mozilla can remove MV2 some day. The migration is small because state lives in storage. |
| Keymap as data vs as code | Data | None for rebinding. New behavior comes from snippets or a new DesertFox build. |
| Snippets vs plugin extensions | Snippets | Page code only, no extension APIs. A move to MV3 means a rewrite to the `userScripts` API, which shows the user an extra permission warning. |
| Config as TOML vs Lua | TOML | No loops or helpers. The `search_keys` and `container_keys` sections remove most repetition, and tools can still edit the files. |
| Config through managed storage vs the native host | The native host. Managed storage is removed | A helper program to install and an optional permission. An edit applies with one key and no restart, so temp edits and modes stay. |
| Command line in an iframe vs a shadow root | iframe | Focus handling is harder. Isolation and direct API access are better. |
| Content script in all frames vs the top frame | All frames. A subframe starts its script on its first focus | Hints and keys work inside an embed after `;ff` or a click. The line, which-key and toasts still draw in the top frame, where the user looks. Ad frames the user never enters stay inert, with one idle focus listener each. `hint --all-frames` is the exception: the hints bundle starts each such frame through its loaded flag, so the frame can report and draw labels. |
| Plain `J/K` only vs plus chords | Plus `Alt+J/K` | Two keys for one command. The chord is the only way to switch tabs from about: pages, the PDF viewer or the address bar. |

## Risks

- Keys are lost on a page with no committed document, for example a new tab before its first byte. No extension can fix that. The chords cover it.
- A page that cancels a chord before Firefox sees it blocks the Firefox shortcut. The content script catches the chord first on pages where it runs, so only pages without a content script are exposed.
- Release Firefox needs a signed build for each change in code. `just release` submits the stable version to the AMO listing and installs nothing. Install the approved version from AMO.
- Snippets run code from a config string through `tabs.executeScript`. AMO review of DesertFox can question that. The code comes only from the user's own file, which other extensions with this feature also do.
- Scope creep. The binding map is the scope: a feature not in it needs a reason.

## Not yet built

- A final logo with an off state (see [Toolbar popup](design/interfaces_pages.md#toolbar-popup)).
- A `history` widget for the command line status area. `search_match` waits for a page search built on Firefox's find API, because Firefox's find bar hides its count.
- Jump list entries for a hint pick that stays on the page, and for a find typed with `/`.
- A sidebar that groups tabs by site.
- A command result passed to the next step of a binding (`returns` and `{ from: "previous" }`, see [Invocations and prompts](design/interfaces_cmdline.md#invocations-and-prompts)).
- Real input from the native host, such as a drag across tabs or apps.

## Open questions

- Moving a tab to another window by prompt (old key `wa`) is assumed unused.
- Answered: the help page has a Quick Start page (`#/quick-start`) of plain text, with no interactive walkthrough, and a Practice page (`#/practice`) of fifteen hands-on lessons in the manner of vimtutor: scrolling first, then which-key, heading jumps, hints, forms, input hints, grab, walking a list, search, copying, the command line, tabs, video, marks and ignore mode. Each lesson teaches the fastest key for its task and ticks off the steps the page sees. The video lesson opens a YouTube page in the same tab, and the page embeds nothing. Practice remembers the lesson in view in its address, so `H` returns to it. Practice keeps its own state: a settings change or a move within the page never redraws it, so typed text, a selection and the caret survive. The same rule holds for Settings. Quick Start teaches scrolling, hints, the command line, which-key, page search, caret and visual mode and `g?`, and both pages read every key name from the compiled keymap, so a rebind changes the page. The which-key examples follow `which_key_delay_ms` and `which_key_skip`: they name only a key whose pause opens the panel, and say so plainly when none does. The help page loads bundles on first use, the same way as the new tab page. `runtime.onInstalled` with reason `install` opens the page once, never on an update. Quick Start always opens on a first install.
- Answered: the `storage.local` read takes 6-10 ms (median 8), so buffering stays and inline registration is not needed. See [firefox-behavior.md](firefox-behavior.md), "Phase 1 measurements".
- Answered: Firefox reloads content scripts into open tabs after `runtime.reload` itself, and the reinjection step stays as a fallback. See [firefox-behavior.md](firefox-behavior.md), "Phase 1 measurements".
