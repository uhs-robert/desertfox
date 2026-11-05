# OasisFox design

OasisFox is a keyboard-first Firefox extension. It has a small scope and one command registry. Every command is defined once. Keys, the command line, completion, help, the palette and which-key all read that definition.

The extension works on its own. Oasis Dots adds an optional native host. Through it, Hyprland, Quickshell and the shell list and run the same commands, and which-key can show in the Quickshell HUD.

Status: phase 1 is built on the `feat/phase-1-core` branch. [spike.md](spike.md) holds the measurements this design rests on, and [keymap.md](keymap.md) maps every binding in the current browser config to a command here.

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
  label: "Close tab",
  intent: "Close the current tab and focus the next one, or close the tabs around it.",
  params: [
    { name: "side", type: "enum", values: ["none", "all_before", "all_after", "focus_previous"],
      default: "none", short: { all_before: "B", all_after: "A", focus_previous: "P" },
      value_labels: { focus_previous: "and focus previous" } },
  ],
  runs_in: "background",
  count: "repeat",
  run: async (ctx, { focus }) => { /* ... */ },
});

define("open.search", {
  label: "Search",
  intent: "Search with a keyword engine from the search engine list.",
  name: "search",
  params: [
    { name: "engine", type: "enum", values: from_engines },
    { name: "query", type: "string", main: true, default: { from: "selection" } },
    { name: "where", type: "enum", values: WHERE, default: "here",
      short: { tab: "t", background: "b", window: "w" } },
    { name: "container", type: "string", values: from_containers, short: "c",
      when: { where: ["tab", "background", "window"] } },
  ],
  runs_in: "background",
  run: async (ctx, { engine, query, where, container }) => { /* ... */ },
});
```

The fields follow the Oasis action library (`home/hypr/.config/hypr/lib/act/init.lua`) so the two lists have one shape:

- `id`: `group.name`, lowercase with underscores. Same pattern as Oasis actions.
- `name`: the command line name, set by hand. It is optional, and it holds no `.`. The full id always works on the command line, and it is the name of most commands: you type `tab.close`, `window.new`, `tab.pin`. Only two kinds of command get a name. The one-word commands are `open`, `search`, `paste`, `copy`, `hint`, `find` and `github`. The family words are `tab` (switch), `bookmark` (open), `zoom` (set), `scroll` (lines), `mode` (set) and `help` (open), one per group, for the main action. Names are never derived from the id, because derived names collide (`tab.close` and `window.close`).
- `aliases`: more command line names. The defaults ship none.
- `label`: a short title in sentence case ("Close tab"). Which-key, the palette and completion show it. A key shows this label plus a phrase for each arg its binding sets, see [Which-key](#which-key).
- `intent`: plain text on one line. Its first sentence is the summary that the completion list shows: it starts with a verb, takes at most 60 characters and names no other command. Later sentences are detail. Help, the status page and which-key hover show all of it. The registry rejects an empty or multi-line one, and a test holds every built-in command to the summary rule.
- `params`: typed and named. The types are `int`, `float`, `string`, `bool` and `enum`. A later phase adds `key` (one key press, for marks). A param with no `default` that applies and no `when` is required. The order is for display only.
- `value_labels`: on an `enum` param with a fixed value list, a short phrase for each value ("and focus previous"). Which-key adds the phrase to the label when a binding sets that value, and completion shows it beside the value. Every key must be one of `values`, and the default value has no phrase. A value with no phrase reads as the raw value with spaces for underscores. The registry checks this at define time.
- `description`: one sentence for a flag, under the same rule as the first sentence of an `intent`. A string on a bool or valued param. A map from value to sentence on an enum with a fixed value list, with no entry for the default value. Completion shows it beside the flag. Every flag of a built-in command has one, and a test checks it. The registry checks the sentence at define time when one is present.
- `main`: the one `string` param that config and the command line take as the subject, for example the URL of `open` or the query of `search`. At most one per command.
- `short`: the one-letter flag of a param. A string for a bool or a valued param (`short: "r"` gives `-r`, `short: "c"` on a string gives `-c=Work`). A map from value to letter for an enum with a fixed value list (`{ tab: "t" }` gives `-t`). Never on `main`, `rest` or an enum with a runtime list. `-t -b -w` mean where (tab, background, window) and `-c` means container on every command that has those params. A default value gets no letter, because the printer leaves it out.
- `rest`: marks a `string` param as text with spaces. The grammar already lets the `main` value run to the end of the line.
- `when`: the param is valid only if one other param has one of the listed values. For example, `container` needs `where` to open a new tab or window, because Firefox cannot change the container of an open tab. This is the only kind of condition, apart from the conditional default below. A command that needs more is split into two commands.
- Conditional `default`: `default: { value, when }` with the same `when` syntax. The default applies only while the named param has one of the listed values. Otherwise the param has no default and is required. `open.url` sets `default: { value: "", when: { where: ["tab", "window", "background"] } }` on `url`, so `open` with no URL is an error for `here` and opens the new tab page elsewhere. The default travels in `commands.json`. A conditional default is not allowed on an enum param. Its `when` cannot name a param that has a conditional default itself.
- Every static argument rule lives in the param schema, and one `check_args` applies it for the command line, key map compile, `tools/build-config` and the router. A command handler should never judge argument values. It should report only runtime failures, such as a tab that is gone, a refusal from Firefox or an empty selection. This is the target. Some handlers still refuse argument values (`tab.ts` count, `settings.ts` and others), tracked in issue #152.
- `default`: a value, or a context source (`{ from: "current_url" }`, `"selection"`, `"clipboard"`). The router fills a context source where it is available, so a background command can ask for the page selection.
- `runs_in`: `background` or `content`. The router sends the invocation to that side. A command never runs in both.
- `needs`: what must be true to run it. `content` means a content script in the tab. A permission name means an optional permission. The router refuses with a message instead of failing silently.
- `count`: what a numeric prefix does. `repeat` runs the command that many times. A param name fills that param, for example `tab.goto` takes the count as its `index`. `ignore` drops it.
- `repeatable`: whether `.` can replay the command. The default is true. Eight commands opt out: `command.repeat`, `browser.close_all`, `browser.focus_page`, `config.reload`, `help.open`, `engine.show`, `settings.set` and `settings.unset`.
- `modes`: the modes where a key can run the command. The default is normal.
- `completion`: where the command line list offers the command. Absent means always. `hidden` means never, and a list of modes means only when the line was opened from one of them. Typing the name still runs the command.
- `run`: the handler. It gets the context (tab, frame, mode) and the checked args.

Validation is strict and happens in one place, the same as `Act.resolve` in Oasis. The command line, keys, the native host and the palette all pass through it.

Define-time checks cover names and params too:

- `name` and `aliases` are unique across all commands, snippets included.
- At most one param is `main`, and it is a `string`.
- A long flag names at most one param of a command: no two enum params share a value, and no bool name repeats a value. `_` reads as `-` in a flag, and no value or bool is called `help`. Names and values are lowercase with underscores.
- A short letter is one ASCII letter, never `h`, and unique within the command.
- A `when`, and the `when` of a conditional default, names a param that exists, with valid values, and never the param itself.

A set of options where at most one can apply, for example open, background tab or copy link for a hint, is one `enum` param with a value per option. Two flags from the set both set that param, so the command line rejects them together. No list of exclusions exists. This turns the hint command into five params: `action`, `filter`, `selector` (with `when: { filter: "custom" }`), `text` and the `rapid` switch.

A build step writes `commands.json` from the registry: id, name, aliases, label, intent, params, count, modes and completion. Help, the palette, which-key and the native `list` verb read it. The content script does not load it.

## Invocations and prompts

Every caller produces one shape:

```ts
type Invocation = { id: string; args?: Record<string, unknown>; count?: number };
```

- A key binding is one invocation, or an array of invocations that run in order. Pipes have no replacement, because context sources cover the cases the config uses. If a binding ever needs one command's result, a command declares `returns` with a type, and a later step in the array takes it with `{ from: "previous" }`. The keymap loader checks the types. This is not built until a binding needs it.
- A binding asks for input only through an explicit `prompt`. If a binding leaves a required param out and sets no `prompt`, the loader warns and skips the key. The prompt opens the command line with completion for that param's type. A binding can prefill the prompt from a context source, for example the current URL for editing.
- A binding that starts with `:` carries `prompt: { param, prefill? }` in the stored file. The key types its command into the command line and waits, and the user edits it and presses Enter.
- The command line and the config parse the same grammar into an invocation, as described below. Keymaps and the native host also accept the `args` object.

### Command line syntax

One grammar covers the command line and every binding in the config. The text is what the user types and what a `:` key shows. `search arch -b "rust lifetimes"` becomes:

```json
{ "id": "open.search", "args": { "engine": "arch", "where": "background", "query": "rust lifetimes" } }
```

- The first word is a `name`, an alias or a full id. The config uses the same words, and the build tool maps them to the id.
- Flags come first, then the subject. `--value` sets an enum (`hint --background --links`), `--name` turns a switch on (`hint --rapid`), and `--name=value` sets any param, split at the first `=`: `scroll.pixels --dx=-50`. This is the way to turn a switch off (`--rapid=false`). A declared short letter does the same as the long flag: `-b`, `-r`, and `-c=Work` for a valued param. A hyphen in a flag reads as `_` in the name (`--word-end`).
- There are no `--no-` flags, no space-separated values (`-c Work`) and no clusters (`-tb`). An unknown dash word before the subject is an error, so a typo never becomes a query. `-h` and `--help` show a usage line.
- The subject is the `main` param. The first word that is not a flag starts it, and the rest of the line joins into it: `search arch pacman mirrors` gives the query `pacman mirrors`. After the subject starts, everything is text, so `open https://a.example -b` opens that whole string. Write `--` to end the flags early when the subject starts with a dash: `open -- -b`, `search -- -std c++`.
- Quoted words are never flags, engines, values or `@source`s: `open '-b'` opens the text `-b`. Quote a value that has spaces or `=` with shell rules: `open -t "https://a.example/?q=a b"`.
- When a command has exactly one number param, a bare number is its subject: `tab.goto 1`, `tab.move -1`, `zoom.set 1.5`. A negative number is a value, never a flag. A command with two number params needs `--name=value` for them.
- A command whose only argument is a required value takes it as the bare subject: `mode ignore`, `cmdline.history prev`, `visual.act yank`. `mode --ignore` works too.
- An enum whose values come from a runtime list, the search engine, is the first bare word, and only when it names an engine: `search arch pacman`. An engine name can hold dots (`search github.repo.issues foo`). `--engine=arch` also works, and the printer writes it only when the bare word would not read back. `--` stops the engine check, so `search -- arch maps` searches the default engine for "arch maps". Build time knows the resolved engine names from `search_engines.toml` plus the built-in `duck`, and the command line from the loaded engines. `tools/build-config` warns about an engine name that starts with `-`, because only `--engine=` can name it.
- An unquoted `@current_url`, `@selection` or `@clipboard` is a context source. The router fills it in when the key is pressed. It works as the subject or after `=`.
- A leading `:` (config only) makes the binding type its command into the command line and wait. `gO = ":open -t @current_url"` shows `open -t https://this.page/...`. The stored file names one param to fill: the one that holds a `@source` (which becomes the prefill), else the `main` param, else the first param. A command with no params cannot take a `:`.
- Unknown flags, a param set twice and an unknown source are errors with a message.
- A param whose `when` condition does not hold is an error with a message, for example "container needs where tab, background or window".
- The printer writes the shortest text that reads back as the same args, with short flags: the engine, then flags in param order, then the subject. It leaves out args equal to the default and adds `--` when the subject would read as a flag. `gO` prefills `open -t `. Docs and the help page use the long form.
- Wording says before, after, previous and next, never left or right, because vertical tab layouts exist.
- The `oasisfox run` script uses the same parser.

Completion reads the same definition:

- A command word completes by fuzzy match on the dotted id.
- A `-` lists that command's flags with their descriptions, from `short` and the long names. Flags already set drop out.
- A `--name=` prefix completes that param's value from its source, for example the containers.
- Any other word completes the subject by its type, for example engine names, tabs or bookmarks, then the query.

## Keys and modes

The keymap is data, not code. It maps a mode and a key sequence to an invocation:

```json
{
  "normal": {
    "J": { "id": "tab.next" },
    "D": { "id": "tab.close", "args": { "side": "focus_previous" } },
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
- A mode badge sits in the bottom right corner, 8 px above the bottom edge. The `mode_indicator` setting controls it: `always` (the default), `not_normal` or `off`. The `palette` setting names a theme (default `oasis_moonlight`), see [Themes](#themes). Light or dark follows the system theme.
- The which-key panel is a floating frame with a 1 px tinted border and its title set into the top border. The `which_key_border` setting picks the corners: `square` (the default), `round` or `chamfer`. A footer names the exit keys.
- `browser` mode holds the chords for the Firefox shortcuts. The manifest reserves a fixed number of shortcut slots, and the background assigns the chords to them with `commands.update`. The content script also catches these chords. If it cancels a chord, Firefox does not fire the shortcut as well, which the spike's key-blocking page showed.

## Config

The user config is a directory of files, one file per kind of setting. `tools/build-config` merges them into one JSON file, and Firefox's managed storage hands that file to the extension. The extension reads only the merged file.

### Source files

The tool reads `~/.config/oasisfox/` by default. Every data file is TOML. A leftover `.jsonc` file is an error that names the `.toml` file to write.

| File | Holds |
| --- | --- |
| `keymap.toml` | Every key: bindings per mode, plus the `search_keys` and `container_keys` shortcuts. `""` removes a default binding. |
| `search_engines.toml` | Search engines: a tree of named URL templates with slots (`{query}`, `{repo}`, and others). `%s` still reads as `{query}`. Data only, no keys. The built-in `duck` needs no entry, and an entry named `duck` replaces it. See [Starting engines](#starting-engines). |
| `command_aliases.toml` | Extra command line names, for example `g = "open.search"`. |
| `settings.toml` | Settings such as the which-key delay and the new tab page. |
| `snippets/*.js` | One custom command per file. See [Snippets](#snippets). |
| `themes/<name>.toml` | A local theme that `palette = "<name>"` picks. See [Themes](#themes). |
| `style.css` | Custom CSS for the OasisFox surfaces. See [Styles](#styles). |

Each data file can also have a matching directory, for example `keymap.d/`. The tool merges the main file first, then the files in the directory in name order. A later entry wins for the same key. This is how private config joins without editing public files: a private repo links `keymap.d/50-private.toml` and `snippets/` files into place.

Every key lives in `keymap.toml`. The other files hold only data. A binding is one line of command text, in the grammar of [Command line syntax](#command-line-syntax), or a list of them that run in order, or a table `{ run = "...", label = "..." }` that names the key for which-key (`run` is a string or a list). TOML quotes any key that has symbols, so `"<C-[>"` and `"$"` are quoted and `gx` is not. Two shortcut sections remove most repetition:

```toml
# keymap.toml
[search_keys]                   # sa/Sa, sb/Sb
a = "arch"
b = "brave"

[container_keys]                # ca/Ca, cc/Cc, cp/Cp
a = "Family"
c = "Client"
p = "Personal"

[normal]
J = "tab.next"
b = "bookmark.open"
gO = ":open -t @current_url"    # types the command into the command line and waits
y = ""                          # removes a default binding
ww = { run = ":open -w @current_url", label = "New window, edit current URL" }
```

- `sa` searches with the `arch` engine in this tab, and `Sa` in a new tab.
- `ca` reopens the current page in the Family container, and `Ca` opens a prompt, set by an explicit `prompt` on the generated key, prefilled with the current URL in a new Family tab.
- Containers themselves need no file. Firefox lists their names, colors and icons through `contextualIdentities.query()`, and completion and the `container` param use that list. A name in `container_keys` that does not exist gets a warning at load and is skipped.
- The prefixes for generated bindings (`s` and `S`, `c` and `C`) are settings. An explicit binding in the keymap wins over a generated one.

#### Starting engines

OasisFox has one built-in engine, `duck` (DuckDuckGo), and the `default_engine` setting defaults to it. So clipboard search works with no config. It is added when the config loads and when `tools/build-config` checks names, so the merged file stays as written. An entry named `duck` in `search_engines.toml` replaces the built-in whole. Nothing hides or removes it.

[`examples/engines.toml`](../examples/engines.toml) resolves to 66 engines, `duck` among them, and teaches the tree rules in two worked trees (GitHub and YouTube). Copy it to `~/.config/oasisfox/search_engines.toml` and edit it. A TOML file cannot include another file. A `search_engines.d/` file also works, and a later file replaces the table at the same dotted path (a later `[github.repo]` replaces only that node and leaves `github` alone).

#### Engines

An engine is a named URL template. It replaces the former site commands. No provider is built in except `duck`.

- Slots. `{query}` is the typed or selected text, and `%s` means the same. Page slots read the current tab: `{url}`, `{host}`, `{title}`, `{repo}` (GitHub), `{subreddit}` and `{channel}` (YouTube). Each page slot is a small pure function in `src/shared/engines/slots.ts` with its own message for a page that cannot fill it. `{a|b}` takes the first slot that has a value, so `{query|url}` is the typed address, else this page. `{name:raw}` skips escaping, for a path such as `/web/{url:raw}`. Every other value takes `encodeURIComponent`.
- Tree. A table inside an engine is a child, named with a dot (`github.repo.issues`). A child inherits every field and overrides by name. `label` does not inherit: the label is the chain of labels on the path ("GitHub: this repo: issues"), and a `label` field sets one link. A child cannot be named `url`, `label`, `params` or `fallback`, or like a field or param of its parent. A later file replaces the table at one dotted path.
- Params. `[github.params.type]` declares `default`, `values` (name to URL text) and `children = true`, which generates one child per value. A field set to a value name picks it, and `type = { only = [...] }` narrows the values below that level. A hand-written child beats a generated one. A query pair whose whole value is one empty param (`&type=`) is left out.
- Availability. An engine is available on a page only when every page slot in its URL can be filled. Which-key hides the keys of an unavailable engine, and a group left empty. A key still works when typed, and shows the slot message. An engine with `fallback = "<engine>"` never hides and runs the fallback when its slots cannot fill. Snippets can require slots with a `// requires: repo` header. The background filters the key list, so the content script is unchanged.
- Resolution. `tools/build-config` resolves the tree into a flat map keyed by the dotted name and stores it, so the extension only fills page slots and the query. It also writes `<out>.engines.jsonl`, one sorted engine per line, so a config change shows as a diff. It rejects an unknown slot, a param no URL uses, a field that is neither a known field nor a var some URL reads, a value outside the declared list, a fallback to a missing engine, a fallback loop and a default engine that needs a page slot.
- Help. `help` lists the resolved tree with each engine's URL, slots and the file and level that set each field. `engine.show <name>` opens it at that engine.
- Which tool. A result that is a URL is an engine. Page DOM or several steps is a snippet. Browser APIs (tabs, windows, bookmarks, containers) is a built-in command. A fuller real example: [https://github.com/uhs-robert/oasis-dots/blob/main/home/oasisfox/.config/oasisfox/search_engines.toml](https://github.com/uhs-robert/oasis-dots/blob/main/home/oasisfox/.config/oasisfox/search_engines.toml).

### Merge and checks

The merged file has one section per kind: `keymap`, `search_engines`, `command_aliases`, `settings`, `snippets` and `css`, plus a format version. The stored keymap holds invocations, so the extension never parses command text. The tool:

- rejects unknown files and unknown sections with a message, so a misspelled file name does not vanish silently. A TOML syntax error names the file, line and column.
- parses every binding string with the registry grammar, then checks it, every alias and every snippet against `commands.json` and reports errors before the extension loads.
- reads snippet code and CSS as text and escapes it, so nobody edits code inside JSON.
- generates a JSON Schema for each data file from `commands.json`, so an editor with TOML schema support (Taplo) completes command names and setting names.

The TOML parser (`smol-toml`) is a dev dependency of the tool only. None of it reaches the extension bundles.

### Delivery

Firefox reads `~/.mozilla/managed-storage/<extension id>.json` and gives its `data` to the extension through `browser.storage.managed`. No helper program or extra permission is needed, and nothing in the browser can change the file.

Firefox reads the file only when the extension loads. The spike confirmed this: an edit is invisible until the extension reloads, and Firefox sends no change event. So:

- A `config.reload` command reloads the extension. The new config applies in about 1 s. The reload resets the mode and any open hints.
- After a reload, the key listeners in open tabs are cut off. Firefox loads the content script into open tabs by itself after `runtime.reload`, so the reinjection step stays only as a fallback (see [spike.md](spike.md), "Phase 1 measurements").
- In Oasis Dots, a `just oasisfox-config` recipe runs the tool, and a key can run the recipe and then `config.reload`.
- Users without a shell can import the merged file through the options page. OasisFox stores it in `storage.local`. Managed storage wins when both exist.
- Since 0.1.1 the options page is a read-only status page: the config source, the settings in force, the warnings and the rebuild steps. It has no inputs. The import above stays in phase 3.
- `set` and `unset` change a setting live, with no file edit. A change is an override in `storage.session` (`oasisfox_setting_overrides`), over the config value and under nothing else. It is global, private windows included, and a browser restart clears it. `config.reload` clears it too, because Firefox clears `storage.session` when an extension reloads. A live change never survives a reload. `set name value`, `set name=value`, `set name` (show) and `set name!` (flip a true or false setting) cover the cases. The two prefix settings are refused, because a live change could collide with other keys. The options page tags every value that differs from the default as from `settings.toml` or from a live `set`. Saving a live change back to `settings.toml` is not built.

The background compiles the keymap into a prefix tree and writes it to `storage.local` for the content scripts.

### Styles

Every surface (which-key, the command line, hints and the mode indicator) draws from CSS custom properties, for example `--oasisfox-bg-core`, `--oasisfox-fg-core`, `--oasisfox-accent` (titles and groups), `--oasisfox-secondary` (keys), `--oasisfox-font` and `--oasisfox-radius`. The variables are the stable way to restyle OasisFox. Documented class names use the same `oasisfox-` prefix.

- The defaults are declared on an inner element of each surface, not on the shadow host. The host sits in the page, so page CSS can match it, and variables set there pass into the shadow root. The long prefix and the inner element together keep page CSS out.
- `style.css` and `style.d/*.css` load after the built-in styles in every surface: inside the shadow roots for hints and which-key, and inside the command line page.
- Setting variables covers colors, fonts and sizes. Full selectors can change layout. The documented class names on each surface are part of the public format, and the help page lists them.
- In Oasis Dots, the theme switcher writes `style.d/00-oasis-theme.css` with the variables for the current Oasis theme, then runs the reload. Without Oasis, the built-in defaults apply.
- CSS cannot run code. A `url()` in user CSS makes the page load that address, so the CSS stays in the user's own files like the snippets.

### Themes

A theme file maps colors onto a fixed public list of roles. The theme's own color names never reach OasisFox. A file is TOML with a `[dark]` table, a `[light]` table or both, and a file with one table serves both system settings. Each table maps a role to a `#rgb` or `#rrggbb` color.

The 21 roles: `bg_core`, `bg_mantle`, `bg_crust`, `selection`, `fg_core`, `fg_comment`, `fg_dim`, `fg_muted`, `primary`, `secondary`, `accent`, `border`, `error`, `warn`, `ok`, `info`, `mode_normal`, `mode_insert`, `mode_ignore`, `mode_caret` and `mode_visual`. `fg_core` is the text, `fg_comment` is secondary text, `fg_dim` is hints such as the command line usage line, and `fg_muted` is disabled text, which has no contrast floor. `error`, `warn`, `ok` and `info` color the toast kinds. `bg_core`, `fg_core`, `primary` and `accent` are required. Every other role derives from them when missing, by the one table in `src/shared/theme/derive.ts`. A role's CSS variable is `--oasisfox-` plus the role with hyphens, for example `--oasisfox-bg-mantle`. The list is a contract: a later rename breaks contributed themes, an addition does not. An old name such as `bg`, `fg` or `muted` in a theme file is an unknown role, and the error lists the valid ones.

`palette = "<name>"` looks in `<config dir>/themes/<name>.toml` first, then in the built-in themes. The default is `oasis_moonlight`, and a bare name such as `moonlight` is a config error that lists the known names. A local file wins over a built-in theme of the same name.

The 16 Oasis themes are not TOML. `themes/oasis/` holds byte copies of the oasis.nvim CSS files, one dark file and five light files per theme (`just oasis-themes <oasis.nvim dir>` copies them). `tools/build_themes.ts` reads each role from one named `--oasis-*` variable, with no mixing, and the table of which variable fills which role is at the top of that file. The `light_intensity` setting (1 to 5, default 3) picks the light set of an Oasis theme. Other themes have one light set. `tools/build-config` checks every local theme file and rejects an unknown role (the error lists the valid ones), a missing required role and a bad color, each with the file, table and key. `just themes` compiles `themes/oasis/*.css` and the contributed `themes/*.toml` into `src/shared/themes.ts`, and `just test` fails when that module is stale. Today a theme sets only the mode badge colors: the badge is the `mode_*` role with `bg_core` as the text.

`primary` is the brand color (links, the normal mode badge) and `accent` is the hint background and focus marks. Today the surfaces use `--oasisfox-accent` for the brand color. From theme PR 2 on, `--oasisfox-accent` holds the `accent` role instead. A `style.css` that sets or reads `--oasisfox-accent` for the brand color moves to `--oasisfox-primary`.

## Snippets

A snippet is a user command written as page code. It is how users add behavior that OasisFox does not ship, for example helpers for one private web app. OasisFox has no plugin system: snippets are the only extension point.

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

- `short=` gives a bool or a valued param its flag letter (`short=a`). An enum maps values to letters: `short=tab:t,window:w`. The letter rules are the define-time checks above.
- `modes` is optional. It lists the modes where a key can run the snippet, from `normal`, `caret` and `visual`. The default is `normal`. Any other name is a build-config error.
- `tools/build-config` turns the header into a normal registry entry. Snippet commands get keys, which-key rows, help, completion and prompts (through an explicit `prompt`) the same as built-in commands.
- The router checks args, then runs the code in the tab's content script with `tabs.executeScript`, with `args` defined. `window.wrappedJSObject` reaches the page's own functions.
- `matches` limits where the command runs. On other pages the router refuses with a message.
- Errors from the code are caught and shown as a message, with the snippet id.
- Snippets have no storage of their own. The code runs in the content script world, so the body's scope hides `browser` and `chrome`. That guards against accidents and is not a sandbox: `globalThis.browser` still reaches the extension APIs, and the code is the user's own.
- A snippet runs other commands with `oasisfox.run(command_text)`, which takes the same text as the command line, for example `await oasisfox.run("open -t https://example.com")`. It rejects when the command fails. Snippets can call snippets up to 5 levels deep.
- A relative URL in `fetch` resolves against the extension, not the page. Build the address from `location.origin`, for example `fetch(location.origin + "/api/items")`.
- Snippet ids cannot use a group name that OasisFox uses.

The config file is code, so whoever can write it can run code on pages. The file lives in the user's home directory and only the user's own tools write it, so this adds no new access. An import through the options page shows the snippet ids and asks before it stores them.

## Routing

1. The content script catches a trusted `keydown` in the capture phase on `window`, at `document_start`.
2. It walks the prefix tree for the current mode. On a match it cancels the key and its keypress and keyup.
3. It runs a `content` command itself. It sends a `background` command to the background page.
4. The background resolves context sources, checks args and runs the handler. Tab commands act on the tab that is active when they run, never on the tab that was active when the key arrived.

A Firefox shortcut enters at step 4 through `commands.onCommand`.

`.` (`command.repeat`) replays the last request that ran to the end. The router stores it in `storage.session` after every step succeeded, with the count it had. A private window has a slot of its own. Only `background` commands are stored, so `j` then `.` does nothing, and a request that opens the command line stores nothing until the typed command runs. A hint start records itself from the `hints` bundle, so `.` after a hint pick shows hints again with the same action and filter. `3.` replaces the stored count and `.` keeps it. With nothing stored, `.` shows "Nothing to repeat". A pick that opens a link runs as `open.url` marked `from_hints`, which the router does not store, so `.` shows hints and does not reopen the address. A replay re-reads context sources such as the selection and the clipboard, so it uses their values at that time.

The content script must have the keymap before the first key. It reads the compiled prefix tree from `storage.local` at start, buffers keys until the read returns, then replays them. Phase 1 measured that read at 6-10 ms (median 8), so buffering is enough and inline registration is not needed (see [spike.md](spike.md), "Phase 1 measurements").

## Bundles and loading

- `background.js`: the registry, the handlers, keymap validation and the shortcut slots.
- `content.js`: the key listener, the prefix tree, the modes and scrolling. Target: under 16 KB minified.
- Hints, which-key, caret and visual mode are separate files. Snippets run as their own code. The background injects one with `tabs.executeScript` on first use in a tab.
- `cmdline.html`: an extension page in an iframe. It has its own bundle with completion and fuzzy matching.

## Interfaces

### Command line and completion

The command line is an extension page in an iframe, so page scripts and CSS cannot reach it. It reads the stored keymap itself and asks the background for everything else. Keys typed while it opens are buffered and replayed.

The list opens with the line and shows every command, so the line is never an empty list. Each row has a name, the first sentence of the intent, the args (flag names and the subject) and, in a later piece, the keys. In a narrow window the description shrinks first, then the args collapse to "…". The name never drops. The list shows up to 10 rows of 26px, with no scroll bar, and the host grows the frame upward to fit.

The cursor word decides what the list offers. A first word completes command names, fuzzy over the whole dotted name: `tab.` lists the tab family and `tc` finds `tab.close`. A word that starts with `-` lists the flags of that command with their descriptions, and the value after `=` lists the values of that param. Any other word lists the subject candidates. A quoted word never completes, and after `--` only the subject candidates show. One fuzzy scorer ranks every source: a name hit beats a description hit, a dot is a word break, an exact name ranks first and a tie goes to the shorter name.

Tab previews the selected row in the line and cycles. The list keeps ranking the text the user typed, and typing starts over. A single match goes in at once. Up and Down move and preview like Tab while the list is open, and stop at its ends. On a fresh line, before any typing or Tab, and with the list closed, they walk the history, so `:` Up Enter reruns the last command. Escape closes the list first and the line second. Enter runs the line as shown. The note row shows the usage of the selected row, or "no match".

Completion sources load only when the param being completed needs them: commands, open tabs, bookmarks, search engines, containers and enum values.

Tabs and bookmarks come from the background, because it knows the window and privacy of the line's tab. A string param asks for them with `values: { from: "tabs" }` or `{ from: "bookmarks" }`. The page asks once per kind, keeps the answer for the line and ranks it with the shared scorer on every key. The row list shows "loading" in the note row until the answer lands. Each kind has its own fetch in flight, so kinds do not drop each other. A reply is dropped when the line has closed. The background answers only a tab whose line redeemed a ticket, until that tab closes or navigates. A normal line lists only normal tabs and a private line only private tabs. Bookmarks list in both.

- A tab row reads `3: GitHub`: the number is the tab's place in its window's tab bar, counted from 1, so it stays while the user types. Picking it puts the number and title in the line. `tab` reads a leading number as that place, and the number wins over the title. Other text is a fuzzy match on title and address, and an equal tie is refused with both tabs named. The `completion_all_windows` setting (default false) lists the tabs of every window. The same number then exists once per window, so the title picks one, else the line's own window.
- `tab.unload` and `tab.load` free and restore a tab's memory (default keys `tu`, `tU`, `tH`, `tL`). They take a subject like `tab`, a `side` and a `count`. Unloading the current tab switches to the alternate tab first, else the next loaded tab, else the previous one. Audible tabs and the active tab of another window are refused, and a side or a count skips pinned tabs. `tab.load` reloads in place and keeps focus. Both report one line, such as "unloaded 3 tabs, skipped 1 (audible)". In the list, `<A-u>` (`list.act --action=unload`) unloads the highlighted tab row, or loads it when it is unloaded. The list stays open and the row shows the change, with its name dimmed while unloaded. The line's own tab cannot unload this way, because the line lives in it. `list.act` is the one row-action command: later row keys add actions to it.
- The `cmdline_prompt` setting sets the text before the input. `caret` (the default) shows `> `, bold, in the `secondary` theme role. `colon` shows `:` in the `accent` role, normal weight, with a small gap. Any other value is custom text in the caret style and holds its own trailing space. Every value is 1 to 8 characters on one line.
- A bookmark row shows the title and the address. With no word typed, the list shows the 20 newest. Picking one puts the address in the line. `bookmark` takes an exact address first, then the best fuzzy match, and refuses an equal tie.
- A tab row leads with fixed-width cells, in this order: a status cell (`%` the current tab, `#` the alternate tab, which is the tab the user was on before, then small icons for pinned, audible, muted and discarded), a container mark, a favicon, then the name, the address and the keys. The icons are CSS masks, so they take the text color. The container mark is Firefox's own container icon in the container color, and a colored dot when the icon cannot load. The default container and private tabs have no mark. The favicon is sent only for http, https and data: URLs up to 2048 characters, and a failed load shows a plain glyph. The favicons load from the network when the list opens, for each listed tab, in the command line's tab context (its container and private state), not the listed tab's. `#` is the tab the window was on before its current one, which the background tracks from `tabs.onActivated` in `storage.session`. The `contextualIdentities` lookup fails quietly when containers are off, and then no row has a mark.
- `open` and its tab variants complete from bookmarks and history (`values: { from: "open" }`, `kind: "open"`). The background answers every row, tagged `bm` or `hist`, in the group order of the `open_completion` setting (default `["bookmarks", "history"]`, a source left out is not read), and drops a history row whose address is a bookmark. History comes from `history.search` with all time and up to 1000 entries, minus `about:`, `moz-extension:` and `data:` addresses. A private line lists no history. With no word typed the page shows the 20 newest bookmarks and `history_completion_max` history rows (default 10), a cap that rides in the answer. A typed word ranks every row and keeps the groups in order. A dim `bm` or `hist` cell tells the rows apart. Enter on text that matches no row still opens the address or searches with the default engine. The `history` permission adds an install prompt on update.
- Engines ride the same fetch (`kind: "engines"`) for the first word of `search`, `--engine=` and `engine.show`. A row shows the engine name and its label. The background marks each engine with a yes or no for whether the line's tab page can fill its slots, and sends no page data. A row the page cannot fill is dimmed and reads "unavailable" in the args column; `engine.show` marks none. A word that ends in a dot (`github.`) lists every engine under that prefix, deeper ones included. The parser still reads a hidden engine, so a picked or typed one runs and the router refuses it.

### Hints

- Candidates come from one query per filter (all, clickable, buttons, inputs, links, prose, scrollable): a selector plus an optional test, such as `prose` keeping elements with a text node of their own. The search reaches open shadow roots and, through Firefox's `openOrClosedShadowRoot`, closed ones.
- An IntersectionObserver batch finds visible candidates. An `elementFromPoint` check removes covered ones.
- Labels render in a closed shadow root. All layout reads happen before any write.
- The actions are open, background tab, new window, start caret mode, start visual mode, copy link, copy text, delete element and focus. Rapid mode keeps hints open for several picks.

### Which-key

Which-key is a first-class surface. After a prefix key, it lists each possible next key with the label of its command. Hovering a row shows the command's intent. It reads both from the registry, so a new command appears without extra work.

The label of a key comes from one rule, applied to the args the binding sets (never the defaults the validator fills in):

- A binding `label` wins. It exists in the TOML table form and on the bindings of the default keymap. On a key that runs several commands, the label sits on the first command.
- A key that sets a container reads as the container name, and the container named `default` reads "Default container".
- Otherwise the label is the command label. A search engine with a label in `search_engines.toml` replaces it (a child engine's label is the chain of labels on its path), and a binding with no engine uses the default engine. Then each `enum` arg the binding sets to a non-default value adds its `value_labels` phrase, in param order ("Open URL in new tab"). A `bool` set to true adds the param name ("Reload hard"). Numbers, free strings and prompted params add nothing, so the keys that set them carry a hand `label` ("Scroll left", "Zoom in a lot"). A phrase that the name of any group above the key already says, as whole words and in any case, is left out: under a group named "Search in new tab", the key reads "Google", not "Google in new tab".
- A snippet key shows the `// label:` header of its snippet.

Two keys in one group may share a label only when they run the same binding (`zi` and `z+`). The unit tests check this for every group of the default keymap and of a copy of the user config, and print each group's labels.

- In the browser it draws in a closed shadow root, styled through the CSS variables in [Styles](#styles). It appears after a delay that is a setting.
- With the native host, it can show in the Quickshell which-key HUD instead. The host writes the rows as `{ "items": [...] }` and calls the `hyprvim_whichkey` IPC target (`open <path>` and `close`). The HUD then uses the current Oasis style. Mouse hover works only in the browser version.

### Caret and visual

Caret mode puts a text cursor in the page, so the user can move through text with vim motions. Visual mode extends a selection with the same motions.

- Caret mode starts at the first visible text, or at a hinted element with `hint.run action=caret`, and visual mode at one with `action=visual`. `v` starts a character selection and `V` a line selection.
- The motions are `h`, `j`, `k`, `l`, `w`, `b`, `e`, `0`, `$`, `gg` and `G`, with count prefixes. The line motions (`j`, `k`, `0`, `^`, `$`) use Firefox's `Selection.modify`, so a wrapped paragraph moves per screen line, and `j` and `k` keep their column. The other motions run on a text model of the visible page, and word motions count letters and digits of any script.
- `f`, `t`, `F` and `T` read the next key as a target character and move to its next match in the paragraph (the text between two newlines), exact case. `t` stops before the match and `T` after it. A count picks the Nth match, and with fewer matches the caret stays. `;` repeats the last find and `,` repeats it the other way, and `t;` steps over an adjacent match. The target is any printable key, even a bound one. Escape cancels the find, and a chord cancels it and then runs. In visual mode the selection end moves. The handler arms a pending state in the caret bundle, and the sink takes the next key.
- In visual mode, `o` swaps the ends of the selection, `y` copies it, and `s` searches it with `open.search` and the `default_engine` setting. Any command whose param defaults to `{ from: "selection" }` uses it. Escape returns to caret mode, then to normal mode.
- The motions are registry commands in the `caret` and `visual` modes, so keys, which-key and help cover them like any other command.
- Page text inside inputs and text areas belongs to insert mode, not caret mode.

### Page search

- `/` and `?` open the command line as a search line and search the page text as you type. `n` and `N` go to the next and previous match in the direction of the last search, and the last search is kept in register `/`. The code lives in `caret.js`, and `content.js` holds only `find.open`, `find.next` and `find.prev`.
- The search covers the page, open and closed shadow roots and same-origin frames. Text in fields is left out. The query is a regular expression with smartcase: a capital letter makes it exact. A typed space matches a line break. A pattern that is invalid, or that could backtrack without end, is searched as plain text instead, and the line says so.
- Enter keeps the highlights and the match, Escape clears the highlights. Both keep the search and the match as the place `n`, `N` and a new caret or visual session go on from.
- In visual mode `/` and `?` move the caret end to the match and keep the anchor. Escape on the line leaves the selection as it was. `n` and `N` do the same with the next and previous match: the caret end goes to the start of the match, so a match before the anchor flips the selection.
- `*` and `#` are `find.open --word` and `find.open --word --backward`. They search the word under the caret, whole and case-sensitive, with no line. In visual mode with a selection they search the selected text. In normal mode the start of the visible text stands in for the caret. They set register `/` like a typed search.
- A `MutationObserver` marks the text model stale when nodes or text change in the page, its shadow roots or its same-origin frames, ignoring the elements OasisFox adds itself. A class or style change that only shows or hides text is not seen, and a new `/` always reads the model again. The next keystroke or `n` reads the model again. The observer starts with the first search.
- A page with more than 4 million characters of text is searched only up to that point, and the line and toast say so.

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
| v1 | Snippets and `config.reload`, with the managed storage config and `tools/build-config`. Normal, insert and ignore modes. Scrolling, back and forward, reload, stop, home, parent and root URL. Tab and window commands, including containers and closed-tab undo. Search engines and explicit prompts. Bookmarks. Hints with every action above, rapid mode included. Copying the URL in 6 formats. Zoom. Search engines with slots and children replace the former site commands (site search, GitHub, subreddit, archive, isdown, translate), which now ship as examples. |
| Later | History completion. Marks and quickmarks. Changing the number in a URL, following next and previous page links, the jump list, a QR code of the URL and view source. |
| Dropped | Shell access, string eval, command strings with chaining and pipes, a config language, userChrome editing, rewriting Firefox prefs, an external editor, page-event hooks, per-site config, a key-grab mode, macros, a theme engine, an update nag, an interactive tutorial and joke commands. |

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
3. Phase 2, interfaces. Command line, completion, explicit prompts, hints, which-key, snippets, and caret and visual modes. Exit: the whole v1 column of the binding map works, and OasisFox replaces the current extension in daily use.
4. Phase 3, browser data. History completion, marks, the remaining later rows, and the options page import for users without a shell.
5. Phase 4, Oasis. The native host merged with voxcmd's, `oasisfox list` and `run`, the Quickshell which-key, and the Oasis theme file written on theme change.

## Open questions

- Moving a tab to another window by prompt (old key `wa`) is assumed unused.
- Answered: OasisFox owns the new tab page through `chrome_url_overrides`. `new_tab_page` is a web URL, which the page redirects to, or `oasisfox` for the built-in page, and unset means the built-in page. `home_page = "oasisfox"` opens the built-in page, even when `new_tab_page` redirects. After Firefox's one-time "Your new tab has changed" notice, its hidden Keep Changes button keeps access key K for that browser session, so Alt+K (previous tab) does nothing on about: pages until a restart. Accepting the notice once avoids it. Firefox still gives the address bar focus on Ctrl+T, so the user presses Esc or clicks the page before keys work. The page loads `content.js`, `ui.js`, `hints.js`, `whichkey.js` and `cmdline.js` by script tag, because `executeScript` cannot reach extension pages. See [`src/newtab/README.md`](../src/newtab/README.md).
- Answered: the built-in new tab page shows a clock and the date. `newtab_clock` is `false` (off), `true` or `"analog"` (a 12 hour analog face with no tick marks, the default) or `"digital"` (seven-segment `HH:mm` in the DSEG7 Classic font, shipped with its OFL text and declared only on this page). `newtab_clock_format` is 12 (default, with an AM or PM suffix) or 24 and applies to the digital clock only. `newtab_date` switches the date off. The page makes no network request. The page colors are var() fallbacks over the theme roles (`bg_core`, `fg_core`, `primary`, `accent`, `bg_mantle`, `border`), so a bare install shows a dark blue page and a theme restyles it once the role variables reach the page.
- Answered: the help page has a Quick Start page (`#/quick-start`) of plain text, with no interactive walkthrough. It teaches scrolling, hints, the command line, which-key, page search, caret and visual mode and `g?`, and it reads every key name from the compiled keymap, so a rebind changes the page. The help page loads `hints.js`, `whichkey.js`, `cmdline.js` and `caret.js` by script tag, for the same reason as the new tab page. `runtime.onInstalled` with reason `install` opens the page once, never on an update. The `open_quick_start_on_install` setting (default on) turns that off. A first install has no config, so the setting helps managed setups, where the config is there from the start. A user who builds a config after the first install sees the page once regardless.
- Answered: the `storage.local` read takes 6-10 ms (median 8), so buffering stays and inline registration is not needed. See [spike.md](spike.md), "Phase 1 measurements".
- Answered: Firefox reloads content scripts into open tabs after `runtime.reload` itself, and the reinjection step stays as a fallback. See [spike.md](spike.md), "Phase 1 measurements".
