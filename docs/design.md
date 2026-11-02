# OasisFox design

OasisFox is a keyboard-first Firefox extension. It has a small scope and one command registry. Every command is defined once. Keys, the command line, completion, help, the palette and which-key all read that definition.

The extension works on its own. Oasis Dots adds an optional native host. Through it, Hyprland, Quickshell and the shell list and run the same commands, and which-key can show in the Quickshell HUD.

Status: phase 1 is built on the `feat/phase-1-core` branch. [spike.md](spike.md) holds the measurements this design rests on, and [keymap.md](keymap.md) maps every binding in the owner's current browser config to a command here.

## Constraints from Firefox

The spike measured these on Firefox 159 with real key presses. They shape every choice below.

- A content script catches plain keys such as `Shift+J` on web pages only. It catches nothing on about: pages, addons.mozilla.org, view-source, reader view, the PDF viewer, or while the address bar has focus.
- `moz-extension://` pages do not match `<all_urls>`, so no content script runs on them by itself. The help page loads `content.js` with a script tag, and `tabs.sendMessage` reaches it like any other tab.
- The `commands` API (Firefox shortcuts) catches a modifier chord such as `Alt+J` everywhere except on a page that cancels the key first. Firefox rejects bare keys and Shift plus a letter there.
- A `document_start` listener is ready 11-58 ms (median 27) after the first byte of a page. Keys before that moment are lost. Navigating from a live page keeps the old listener until the new page commits.
- A message from a content script to the background and back takes under 1 ms. So does a round trip to a native host over an open port.
- Firefox still supports Manifest V2 with a persistent background page. MV3 in Firefox uses event pages that sleep after 30 s.

## Decisions

- Manifest V2 with a persistent background page. No state lives only in memory, so a later move to MV3 changes the manifest and little else.
- TypeScript, bundled with esbuild. No framework. No runtime dependency in the content script.
- No Rust and no WASM. The slow parts are DOM work and messages between processes, not computation. WASM also adds load cost to every page.
- No ex-command language. The command line parses text into the same typed invocation that a key produces. Snippets are the only user code, and only the user's own config file holds them.
- No shell access. The native host has a fixed set of verbs.

## Registry

The registry lives in the background page. A command is plain data plus a handler:

```ts
define("tab.close", {
  label: "Close Tab",
  intent: "Close the current tab and focus the tab on the chosen side.",
  params: [
    { name: "focus", type: "enum", values: ["right", "left"], default: "right" },
  ],
  runs_in: "background",
  count: "repeat",
  run: async (ctx, { focus }) => { /* ... */ },
});

define("open.search", {
  label: "Search",
  intent: "Search with a keyword engine from the search engine list.",
  name: "search",
  aliases: ["s"],
  params: [
    { name: "engine", type: "enum", values: from_engines },
    { name: "query", type: "string", rest: true, default: { from: "selection" } },
    { name: "where", type: "enum", values: WHERE, default: "current", flag: { short: "w" } },
    { name: "container", type: "string", values: from_containers, flag: { short: "c" },
      when: { where: ["new_tab", "background", "new_window"] } },
  ],
  flags: [
    { short: "b", long: "background", sets: { where: "background" }, label: "Open in a background tab" },
    { short: "t", long: "tab", sets: { where: "new_tab" }, label: "Open in a new tab" },
  ],
  runs_in: "background",
  run: async (ctx, { engine, query, where, container }) => { /* ... */ },
});
```

The fields follow the Oasis action library (`home/hypr/.config/hypr/lib/act/init.lua`) so the two lists have one shape:

- `id`: `group.name`, lowercase with underscores. Same pattern as Oasis actions.
- `name`: the command line name, set by hand, for example `search`. It is optional. The full id always works on the command line. Names are never derived from the id, because derived names collide (`tab.close` and `window.close`).
- `aliases`: more command line names, for example `s`.
- `label`: a short title. Which-key, the palette and completion show it.
- `intent`: one sentence. Help, which-key hover and completion details show it.
- `params`: typed and ordered. The types are `int`, `float`, `string`, `bool` and `enum`. A later phase adds `key` (one key press, for marks). Only a trailing run of params can have defaults.
- `rest`: on the last `string` param, it takes all remaining words, so a query needs no quotes.
- `flag`: makes a param a flag on the command line instead of a positional word. The long name is the param name (`--where`). `short` adds a one-letter form (`-w`). A `bool` param with `flag` is a switch, `--private`, and `--no-private` turns it off.
- `flags`: preset flags. Each one sets fixed values on existing params, for example `-b`/`--background` sets `where` to `background`. A preset has a `label` for completion and help, and no handler of its own.
- `when`: the param is valid only if one other param has one of the listed values. For example, `container` needs `where` to open a new tab or window, because Firefox cannot change the container of an open tab. This is the only kind of condition. A command that needs more is split into two commands.
- `default`: a value, or a context source (`{ from: "current_url" }`, `"selection"`, `"clipboard"`). The router fills a context source where it is available, so a background command can ask for the page selection.
- `runs_in`: `background` or `content`. The router sends the invocation to that side. A command never runs in both.
- `needs`: what must be true to run it. `content` means a content script in the tab. A permission name means an optional permission. The router refuses with a message instead of failing silently.
- `count`: what a numeric prefix does. `repeat` runs the command that many times. A param name fills that param, for example `tab.goto` takes the count as its `index`. `ignore` drops it.
- `modes`: the modes where a key can run the command. The default is normal.
- `run`: the handler. It gets the context (tab, frame, mode) and the checked args.

Validation is strict and happens in one place, the same as `Act.resolve` in Oasis. The command line, keys, the native host and the palette all pass through it.

Define-time checks cover names and flags too:

- `name` and `aliases` are unique across all commands, snippets included.
- Short flags are one character. Short and long flag names are unique within a command. `-h` and `--help` are reserved.
- A preset flag sets only params that exist, with valid values.
- A `when` names a param that exists, with valid values, and never the param itself.

A set of flags where at most one can apply, for example open, background tab or copy link for a hint, is one `enum` param with a preset flag per value. Two flags from the set both set that param, so the command line rejects them together. No list of exclusions exists. This turns the hint command's flags into four params: `action`, `filter`, `selector` (with `when: { filter: "custom" }`) and the `rapid` switch.

A build step writes `commands.json` from the registry: id, name, aliases, label, intent, params, flags, count and modes. Help, the palette, which-key and the native `list` verb read it. The content script does not load it.

## Invocations and prompts

Every caller produces one shape:

```ts
type Invocation = { id: string; args?: Record<string, unknown>; count?: number };
```

- A key binding is one invocation, or an array of invocations that run in order. Pipes have no replacement, because context sources cover the cases the config uses. If a binding ever needs one command's result, a command declares `returns` with a type, and a later step in the array takes it with `{ from: "previous" }`. The keymap loader checks the types. This is not built until a binding needs it.
- If a binding leaves a required param out, the command line opens and asks for it, with completion for that param's type. This replaces 89 old bindings that opened the command line with text already typed. A binding can prefill the prompt from a context source, for example the current URL for editing.
- A binding can also carry `prompt: { param, prefill? }`. The key then opens the command palette with the whole command typed in and the param prefilled. Phase 1 refuses such a binding.
- The command line parses a command name, flags and positional words into an invocation, as described below.
- Flags exist only on the command line. Keymaps and the native host use the `args` object.

### Command line syntax

`search -b arch rust lifetimes` becomes:

```json
{ "id": "open.search", "args": { "engine": "arch", "query": "rust lifetimes", "where": "background" } }
```

- The first word is a `name`, an alias or a full id.
- Flags take the forms `--long value`, `--long=value` and `-s value`. Short switches combine, for example `-bp`.
- `--` ends the flags, so a query can start with a dash.
- Words are quoted with shell rules.
- Two flags that set the same param are an error with a message, for example "-b and -t both set where".
- A param whose `when` condition does not hold is an error with a message, for example "--container needs --where new_tab, background or new_window".
- `-h` or `--help` on any command shows a usage line generated from the definition: `search [-b|--background] [-t|--tab] [-w|--where <where>] [-c|--container <name>] <engine> <query...>`.
- The `oasisfox run` script uses the same parser, so `oasisfox run search -b arch rust` works from a shell.

Completion reads the same definition:

- A word that starts with `-` completes to the command's flags, with their labels. Flags already used drop out.
- Completion hides a flag whose `when` condition does not hold yet, and the flags of a set once one of them is used.
- A flag that takes a value completes that value from its source, for example `-w` offers the `where` values and `-c` offers the containers.
- Otherwise the next positional param completes by its type, for example engine names, then the query.

## Keys and modes

The keymap is data, not code. It maps a mode and a key sequence to an invocation:

```json
{
  "normal": {
    "J": { "id": "tab.next" },
    "D": { "id": "tab.close", "args": { "focus": "left" } },
    "sa": { "id": "open.search", "args": { "engine": "arch" } },
    "ca": { "id": "tab.reopen_in_container", "args": { "container": "Family" } }
  },
  "browser": {
    "<A-j>": { "id": "tab.next" },
    "<A-k>": { "id": "tab.prev" }
  }
}
```

- The extension ships a default keymap. The user config overrides it, as described in [Config](#config).
- The background checks each entry against the registry when it loads. A bad entry logs a warning and is skipped, so one typo does not break the rest. The help page lists the warnings.
- Key notation is vim style: `<C-x>`, `<A-j>`, `<S-Escape>`. Sequences match through a prefix tree. A complete match runs at once, with no timeout.
- The modes are normal, insert, ignore, hint and cmdline. Caret and visual modes arrive in phase 2, see [Caret and visual](#caret-and-visual). Insert mode follows `focusin` and `focusout` on editable elements instead of checking the focused element on every key.
- A mode badge sits in the bottom right corner, 8 px above the bottom edge. The `mode_indicator` setting controls it: `always` (the default), `not_normal` or `off`. The `palette` setting picks its colors from the 16 oasis.nvim palettes (default `moonlight`). Light or dark follows the system theme.
- The toolbar button shows the same mode per tab: `NOR`, `INS` or `IGN`, with the tooltip `OasisFox: NORMAL mode` and so on. The same `mode_indicator` and `palette` settings drive it. The hint and command line modes clear the text. Pass-next does not change it until phase 2, so the button keeps showing the mode.
- `browser` mode holds the chords for the Firefox shortcuts. The manifest reserves a fixed number of shortcut slots, and the background assigns the chords to them with `commands.update`. The content script also catches these chords. If it cancels a chord, Firefox does not fire the shortcut as well, which the spike's key-blocking page showed.

## Config

The user config is a directory of files, one file per kind of setting. `tools/build-config` merges them into one JSON file, and Firefox's managed storage hands that file to the extension. The extension reads only the merged file.

### Source files

The tool reads `~/.config/oasisfox/` by default. Every data file is JSONC (JSON with comments and trailing commas).

| File | Holds |
| --- | --- |
| `keymap.jsonc` | Every key: bindings per mode, plus the `search_keys` and `container_keys` shortcuts. `null` removes a default binding. |
| `search_engines.jsonc` | Search engines: URL template and label. The template uses `%s` for the query. Data only, no keys. |
| `command_aliases.jsonc` | Extra command line names, for example `"g": "open.search"`. |
| `settings.jsonc` | Settings such as the which-key delay and the new tab page. |
| `snippets/*.js` | One custom command per file. See [Snippets](#snippets). |
| `style.css` | Custom CSS for the OasisFox surfaces. See [Styles](#styles). |

Each data file can also have a matching directory, for example `keymap.d/`. The tool merges the main file first, then the files in the directory in name order. A later entry wins for the same key. This is how private config joins without editing public files: a private repo links `keymap.d/50-private.jsonc` and `snippets/` files into place.

Every key lives in `keymap.jsonc`. The other files hold only data. Two shortcut sections remove most repetition:

```jsonc
// keymap.jsonc
{
  "search_keys": { "a": "arch", "b": "brave" },                       // sa/Sa, sb/Sb
  "container_keys": { "a": "Family", "c": "Client", "p": "Personal" },  // ca/Ca, cc/Cc, cp/Cp
  "normal": { "J": { "id": "tab.next" } }
}
```

- `sa` searches with the `arch` engine in this tab, and `Sa` in a new tab.
- `ca` reopens the current page in the Family container, and `Ca` opens a prompt prefilled with the current URL in a new Family tab.
- Containers themselves need no file. Firefox lists their names, colors and icons through `contextualIdentities.query()`, and completion and `--container` use that list. A name in `container_keys` that does not exist gets a warning at load and is skipped.
- The prefixes for generated bindings (`s` and `S`, `c` and `C`) are settings. An explicit binding in the keymap wins over a generated one.

### Merge and checks

The merged file has one section per kind: `keymap`, `search_engines`, `command_aliases`, `settings`, `snippets` and `css`, plus a format version. The tool:

- rejects unknown files and unknown sections with a message, so a misspelled file name does not vanish silently.
- checks every binding, alias and snippet against `commands.json` and reports errors before the extension loads.
- reads snippet code and CSS as text and escapes it, so nobody edits code inside JSON.
- generates a JSON Schema for each data file from `commands.json`, so an editor completes command ids, args and setting names.

### Delivery

Firefox reads `~/.mozilla/managed-storage/<extension id>.json` and gives its `data` to the extension through `browser.storage.managed`. No helper program or extra permission is needed, and nothing in the browser can change the file.

Firefox reads the file only when the extension loads. The spike confirmed this: an edit is invisible until the extension reloads, and Firefox sends no change event. So:

- A `config.reload` command reloads the extension. The new config applies in about 1 s. The reload resets the mode and any open hints.
- After a reload, the key listeners in open tabs are cut off. Firefox loads the content script into open tabs by itself after `runtime.reload`, so the reinjection step stays only as a fallback (see [spike.md](spike.md), "Phase 1 measurements").
- In Oasis Dots, a `just oasisfox-config` recipe runs the tool, and a key can run the recipe and then `config.reload`.
- Users without a shell can import the merged file through the options page. OasisFox stores it in `storage.local`. Managed storage wins when both exist.
- Since 0.1.1 the options page is a read-only status page: the config source, the settings in force, the warnings and the rebuild steps. It has no inputs. The import above stays in phase 3.

The background compiles the keymap into a prefix tree and writes it to `storage.local` for the content scripts.

### Styles

Every surface (which-key, the command line, hints and the mode indicator) draws from CSS custom properties, for example `--oasisfox-bg`, `--oasisfox-fg`, `--oasisfox-accent`, `--oasisfox-font` and `--oasisfox-radius`. The variables are the stable way to restyle OasisFox. Documented class names use the same `oasisfox-` prefix.

- The defaults are declared on an inner element of each surface, not on the shadow host. The host sits in the page, so page CSS can match it, and variables set there pass into the shadow root. The long prefix and the inner element together keep page CSS out.
- `style.css` and `style.d/*.css` load after the built-in styles in every surface: inside the shadow roots for hints and which-key, and inside the command line page.
- Setting variables covers colors, fonts and sizes. Full selectors can change layout. The documented class names on each surface are part of the public format, and the help page lists them.
- In Oasis Dots, the theme switcher writes `style.d/00-oasis-theme.css` with the variables for the current Oasis theme, then runs the reload. Without Oasis, the built-in defaults apply.
- CSS cannot run code. A `url()` in user CSS makes the page load that address, so the CSS stays in the user's own files like the snippets.

## Snippets

A snippet is a user command written as page code. It is how users add behavior that OasisFox does not ship, for example helpers for one private web app. OasisFox has no plugin system: snippets are the only extension point.

A snippet file has a header with the command fields, then the code:

```js
// id: myapp.toggle_ids
// label: Toggle IDs
// intent: Show or hide record IDs in My App.
// matches: https://app.example.com/*
// name: ids
// param: query string default=selection
// flag: --all -a bool
window.wrappedJSObject.my_app.toggle_ids(args.query);
```

- `tools/build-config` turns the header into a normal registry entry. Snippet commands get keys, which-key rows, help, completion and prompts for missing params the same as built-in commands.
- The router checks args, then runs the code in the tab's content script with `tabs.executeScript`, with `args` defined. `window.wrappedJSObject` reaches the page's own functions.
- `matches` limits where the command runs. On other pages the router refuses with a message.
- Errors from the code are caught and shown as a message, with the snippet id.
- Snippets have no storage and no extension APIs of their own. A snippet can run other commands through `oasisfox.run(id, args)`.
- Snippet ids cannot use a group name that OasisFox uses.

The config file is code, so whoever can write it can run code on pages. The file lives in the user's home directory and only the user's own tools write it, so this adds no new access. An import through the options page shows the snippet ids and asks before it stores them.

## Routing

1. The content script catches a trusted `keydown` in the capture phase on `window`, at `document_start`.
2. It walks the prefix tree for the current mode. On a match it cancels the key and its keypress and keyup.
3. It runs a `content` command itself. It sends a `background` command to the background page.
4. The background resolves context sources, checks args and runs the handler. Tab commands act on the tab that is active when they run, never on the tab that was active when the key arrived.

A Firefox shortcut enters at step 4 through `commands.onCommand`.

The content script must have the keymap before the first key. It reads the compiled prefix tree from `storage.local` at start, buffers keys until the read returns, then replays them. Phase 1 measured that read at 6-10 ms (median 8), so buffering is enough and inline registration is not needed (see [spike.md](spike.md), "Phase 1 measurements").

## Bundles and loading

- `background.js`: the registry, the handlers, keymap validation and the shortcut slots.
- `content.js`: the key listener, the prefix tree, the modes and scrolling. Target: under 15 KB minified.
- Hints, which-key, caret and visual mode, and the site commands are separate files. Snippets run as their own code. The background injects one with `tabs.executeScript` on first use in a tab.
- `cmdline.html`: an extension page in an iframe. It has its own bundle with completion and fuzzy matching.

## Interfaces

### Command line and completion

The command line is an extension page in an iframe, so page scripts and CSS cannot reach it, and it calls `browser.*` directly. Keys typed while it opens are buffered and replayed.

Completion sources load only when the param being completed needs them: commands, open tabs, bookmarks, search engines, containers and enum values. History completion with ranking comes in phase 3.

### Hints

- Candidates come from one selector per filter: all, clickable, inputs, links. The search reaches open shadow roots and, through Firefox's `openOrClosedShadowRoot`, closed ones.
- An IntersectionObserver batch finds visible candidates. An `elementFromPoint` check removes covered ones.
- Labels render in a closed shadow root. All layout reads happen before any write.
- The actions are open, background tab, new window, select text, copy link, copy text, delete element and focus. Rapid mode keeps hints open for several picks.

### Which-key

Which-key is a first-class surface. After a prefix key, it lists each possible next key with the label of its command. Hovering a row shows the command's intent. It reads both from the registry, so a new command appears without extra work.

- In the browser it draws in a closed shadow root, styled through the CSS variables in [Styles](#styles). It appears after a delay that is a setting.
- With the native host, it can show in the Quickshell which-key HUD instead. The host writes the rows as `{ "items": [...] }` and calls the `hyprvim_whichkey` IPC target (`open <path>` and `close`). The HUD then uses the current Oasis style. Mouse hover works only in the browser version.

### Caret and visual

Caret mode puts a text cursor in the page, so the user can move through text with vim motions. Visual mode extends a selection with the same motions.

- Caret mode starts at the first visible text, or at a hinted element with `hint.run action=select`. `v` starts a character selection and `V` a line selection.
- The motions are `h`, `j`, `k`, `l`, `w`, `b`, `e`, `0`, `$`, `gg` and `G`, with count prefixes. They use Firefox's `Selection.modify`: `move` in caret mode and `extend` in visual mode, by character, word, line and line boundary.
- In visual mode, `o` swaps the ends of the selection, `y` copies it, and `s` searches it with `open.search`. Any command whose param defaults to `{ from: "selection" }` uses it. Escape returns to caret mode, then to normal mode.
- The motions are registry commands in the `caret` and `visual` modes, so keys, which-key and help cover them like any other command.
- Page text inside inputs and text areas belongs to insert mode, not caret mode.

### Help and palette

The help page is generated from `commands.json` and the live keymap: every command, its params, its keys and the keymap warnings. The palette is the command line with an empty prompt.

## Native host (optional)

One long-lived port from the background to a host program. The host merges the existing voxcmd Firefox host (`extras/voxcmd-firefox` in the dotfiles), so there is one extension and one host.

The verbs are fixed:

- `tabs`, `activate`, `clear_preface`: the voxcmd verbs, unchanged.
- `list`: the registry as JSON, in the same shape as `hypr-act list`: `{ version, actions: [{ id, label, intent, params, keys, perform }] }`.
- `run`: one invocation from outside, for example from Hyprland, voice or the shell.
- `whichkey_show`, `whichkey_hide`: drive the Quickshell HUD.

Outside callers reach the host through a Unix socket that it opens, because a desktop program cannot open a channel into the extension. An `oasisfox list` and `oasisfox run <id> [args]` script wraps the socket, the same as `hypr-act`. Oasis can then expose browser commands in its own palette and keymaps.

Firefox keeps the background awake while the port is open, which also helps a later move to MV3.

## Scope

| Phase | Contents |
| --- | --- |
| v1 | Snippets and `config.reload`, with the managed storage config and `tools/build-config`. Normal, insert and ignore modes. Scrolling, back and forward, reload, stop, home, parent and root URL. Tab and window commands, including containers and closed-tab undo. Search engines and the prompt for missing args. Bookmarks. Hints with every action above, rapid mode included. Copying the URL in 6 formats. Zoom. The site commands: site search, repo, subreddit, archive, isdown and translate. |
| Later | History completion. Marks and quickmarks. Changing the number in a URL, following next and previous page links, repeating the last command, the jump list, a QR code of the URL and view source. |
| Dropped | Shell access, string eval, command strings with chaining and pipes, a config language, userChrome editing, rewriting Firefox prefs, an external editor, page-event hooks, per-site config, a key-grab mode, macros, a theme engine, an update nag, a tutorial and joke commands. |

## Trade-offs

| Choice | Picked | Cost |
| --- | --- | --- |
| MV2 persistent vs MV3 event page | MV2 | Mozilla can remove MV2 some day. The migration is small because state lives in storage. |
| Keymap as data vs as code | Data | None for rebinding. New behavior comes from snippets or a new OasisFox build. |
| Snippets vs plugin extensions | Snippets | Page code only, no extension APIs. A move to MV3 means a rewrite to the `userScripts` API, which shows the user an extra permission warning. |
| Config as JSONC vs Lua | JSONC | No loops or helpers. The `search_keys` and `container_keys` sections remove most repetition, and tools can still edit the files. |
| Config through managed storage vs the native host | Managed storage | Each edit needs the merge tool and a reload key, about 2 s. No helper program and no permission warning. |
| Command line in an iframe vs a shadow root | iframe | Focus handling is harder. Isolation and direct API access are better. |
| Content script in all frames vs the top frame | Top frame plus same-origin frames | No hints inside cross-origin iframes. Ad frames do not each get a copy. |
| Plain `J/K` only vs plus chords | Plus `Alt+J/K` | Two keys for one command. The chord is the only way to switch tabs from about: pages, the PDF viewer or the address bar. |

## Risks

- Keys are lost on a page with no committed document, for example a new tab before its first byte. No extension can fix that. The chords cover it.
- A page that cancels a chord before Firefox sees it blocks the Firefox shortcut. The content script catches the chord first on pages where it runs, so only pages without a content script are exposed.
- Release Firefox needs a signed build for each change in code. The voxcmd extension already has an AMO signing recipe and a policy install, which OasisFox reuses.
- Snippets run code from a config string through `tabs.executeScript`. AMO review of OasisFox can question that. The code comes only from the user's own file, which other extensions with this feature also do.
- Scope creep. The binding map is the scope: a feature not in it needs a reason.

## Roadmap

1. Phase 0, spike. Done. See [spike.md](spike.md).
2. Phase 1, core. It covers the registry, `commands.json`, the managed storage config, `tools/build-config`, `config.reload`, keymap validation, the prefix tree, modes, scroll and page commands, tab commands, the shortcut slots and the help page. Exit: every v1 row of the binding map that needs no hints or command line works, and the content script stays under its size target.
3. Phase 2, interfaces. Command line, completion, prompts for missing args, hints, which-key, snippets, and caret and visual modes. Exit: the whole v1 column of the binding map works, and OasisFox replaces the current extension in daily use.
4. Phase 3, browser data. History completion, marks, the remaining later rows, and the options page import for users without a shell.
5. Phase 4, Oasis. The native host merged with voxcmd's, `oasisfox list` and `run`, the Quickshell which-key, and the Oasis theme file written on theme change.

## Open questions

- Moving a tab to another window by prompt (old key `wa`) is assumed unused.
- The current config sets the new tab page to Tabliss. OasisFox can replace the new tab page with `chrome_url_overrides`, but focus then starts in the address bar. Decide in phase 3.
- Answered: the `storage.local` read takes 6-10 ms (median 8), so buffering stays and inline registration is not needed. See [spike.md](spike.md), "Phase 1 measurements".
- Answered: Firefox reloads content scripts into open tabs after `runtime.reload` itself, and the reinjection step stays as a fallback. See [spike.md](spike.md), "Phase 1 measurements".
