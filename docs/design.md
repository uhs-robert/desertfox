# DesertFox design

DesertFox is a keyboard-first Firefox extension. It has a small scope and one command registry. Every command is defined once. Keys, the command line, completion, help, the palette and which-key all read that definition.

The extension works on its own. Oasis Dots adds an optional native host. Through it, Hyprland, Quickshell and the shell list and run the same commands, and which-key can show in the Quickshell HUD.

Status: phase 1 is built on the `feat/phase-1-core` branch. [firefox-behavior.md](firefox-behavior.md) holds the measurements this design rests on, and [keymap.md](keymap.md) maps every binding in the current browser config to a command here.

## Constraints from Firefox

Phase 0 measured these on Firefox 159 with real key presses. They shape every choice below.

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
- `name`: the command line name, set by hand. It is optional, and it holds no `.`. The full id always works on the command line, and it is the name of most commands: you type `tab.close`, `window.new`, `tab.pin`. Only two kinds of command get a name. The one-word commands are `open`, `search`, `paste`, `copy`, `hint`, `heading`, `find` and `github`. The family words are `tab` (switch), `bookmark` (open), `history` (open), `zoom` (set), `scroll` (lines), `mode` (set) and `help` (open), one per group, for the main action. Names are never derived from the id, because derived names collide (`tab.close` and `window.close`).
- `aliases`: more command line names. The defaults ship none.
- `label`: a short title in sentence case ("Close tab"). Which-key, the palette and completion show it. A key shows this label plus a phrase for each arg its binding sets, see [Which-key](#which-key).
- `intent`: plain text on one line. Its first sentence is the summary that the completion list shows: it starts with a verb, takes at most 60 characters and names no other command. Later sentences are detail. Help, the status page and which-key hover show all of it. The registry rejects an empty or multi-line one, and a test holds every built-in command to the summary rule.
- `params`: typed and named. The types are `int`, `float`, `string`, `bool` and `enum`. A later phase adds `key` (one key press, for marks). A param with no `default` that applies, no `optional` and no `when` is required. The order is for display only.
- Value rules, plain data that travels in `commands.json`: `min` (the smallest value of an `int`), `pattern` (the source of a regular expression that a `string` must match), `strict` (a `string` with a static `values` list accepts only those values, where `values` alone is completion only) and `optional` (a `string` or `enum` may be left out or empty and then reads as `""`, in place of `default: ""`) and `value_of` (a `string` holds the value of the setting named by a sibling `strict` param, and `check_args` checks it with that setting's entry in `SETTING_SPECS`, an empty value passing). `strict` compares exactly, like an enum value. `check_args` applies them. The registry checks at define time that each sits on a param type that can carry it.
- `value_labels`: on an `enum` param with a fixed value list, a short phrase for each value ("and focus previous"). Which-key adds the phrase to the label when a binding sets that value, and completion shows it beside the value. Every key must be one of `values`, and a value that is the default in every context has no phrase. A value with no phrase reads as the raw value with spaces for underscores. The registry checks this at define time.
- `description`: one sentence for a flag, under the same rule as the first sentence of an `intent`. A string on a bool or valued param. A map from value to sentence on an enum with a fixed value list, with no entry for a value that is the default in every context. Completion shows it beside the flag. Every flag of a built-in command has one, and a test checks it. The registry checks the sentence at define time when one is present.
- `main`: the one `string` param that config and the command line take as the subject, for example the URL of `open` or the query of `search`. At most one per command.
- `short`: the one-letter flag of a param. A string for a bool or a valued param (`short: "r"` gives `-r`, `short: "c"` on a string gives `-c=Work`). A map from value to letter for an enum with a fixed value list (`{ tab: "t" }` gives `-t`). Never on `main`, `rest` or an enum with a runtime list. `-t -b -w` mean where (tab, background, window) and `-c` means container on every command that has those params. A default value gets no letter, because the printer leaves it out.
- `rest`: marks a `string` param as text with spaces. The grammar already lets the `main` value run to the end of the line.
- `when`: the param is valid only if one other param has one of the listed values. For example, `container` needs `where` to open a new tab or window, because Firefox cannot change the container of an open tab. This is the only kind of condition, apart from the default list and `value_when` below. A command that needs more is split into two commands.
- Default list: `default: [{ value, when }, ..., plain]`, an ordered list of arms with an optional plain value last. Each arm uses the `when` syntax, and unlike a param's own `when` it may name several params, which must all have a listed value (AND). The first arm that holds wins, else the plain value applies, else the param has no default and is required. `open.url` sets `default: [{ value: "", when: { where: ["tab", "window", "background"] } }]` on `url`, so `open` with no URL is an error for `here` and opens the new tab page elsewhere. A hint `action` can default to `play_pause` for the `media` filter and to `here` otherwise. An arm may name a param that has a default list itself, the define check refuses a cycle and names its path (`action -> filter -> action`), and an arm that names several params makes the param depend on each of them. The list travels in `commands.json`. Help prints the plain value first, then each arm: `here; play_pause when filter is media`, and `background when filter is links and rapid is true` for an arm with two params. A value that is the default under only some arms keeps its flag, short, phrase and description, because it is a choice elsewhere. Flag completion hides the value that is the default for the flags already typed. The printer drops an arg equal to the default that the other args give, so `.` replays the same value. The key compiler stores the resolved default in the leaf.
- `value_when`: on an `enum` param, `{ value: { sibling: [values], ... } }`. The value is allowed only while every named sibling has a listed value (AND, as in a default arm). A value with no entry is allowed everywhere, so a new sibling value gets no restricted enum value until someone lists it. `check_args` checks the final value, explicit or default, so a combination that makes no sense is an error on the command line and never compiles into a key. A hint `action` of `background` needs a `filter` that has an address, and `mute` needs `media`. The define check refuses a key that is not one of `values`, a bad sibling, and a default arm whose value its own condition does not allow (the arm must name every sibling the rule names). The rules travel in `commands.json`.
- Every static argument rule lives in the param schema, and one `check_args` applies it for the command line, key map compile, `tools/build-config` and the router. A context source (`@selection`) passes the check as a marker, so the router runs `check_args` again on the expanded text. `help` takes a page name (`quick_start`) or a command id, matched exactly. A command handler never judges argument values. It reports only runtime failures, such as a tab that is gone, a refusal from Firefox or an empty selection, and throws them as `RuntimeRefusal`. `test/registry/handler_static_rules.test.ts` fails when a background handler throws anything else on args the schema accepts.
- `default`: a value, or a context source (`{ from: "current_url" }`, `"selection"`, `"clipboard"`). The router fills a context source where it is available, so a background command can ask for the page selection.
- `runs_in`: `background` or `content`. The router sends the invocation to that side. A command never runs in both.
- `needs`: what must be true to run it. `content` means a content script in the tab. A permission name means an optional permission. The router refuses with a message instead of failing silently.
- `count`: what a numeric prefix does. `repeat` runs the command that many times. A param name fills that param, for example `tab.goto` takes the count as its `index`. `ignore` drops it.
- `repeatable`: whether `.` can replay the command. The default is true. Twelve commands opt out: `command.repeat`, `browser.close_all`, `browser.focus_page`, `config.reload`, `debug.restart`, `frame.exit`, `help.open`, `native.install`, `engine.show`, `settings.set`, `settings.toggle` and `settings.unset`.
- `modes`: the modes where a key can run the command. The default is normal.
- `completion`: where the command line list offers the command. Absent means always. `hidden` means never, and a list of modes means only when the line was opened from one of them. Typing the name still runs the command.
- `run`: the handler. It gets the context (tab, frame, mode) and the checked args.

Validation is strict and happens in one place, the same as `Act.resolve` in Oasis. The command line, keys, the native host and the palette all pass through it.

Define-time checks cover names and params too:

- `name` and `aliases` are unique across all commands, snippets included.
- At most one param is `main`, and it is a `string`.
- A long flag names at most one param of a command: no two enum params share a value, and no bool name repeats a value. `_` reads as `-` in a flag, and no value or bool is called `help`. Names and values are lowercase with underscores.
- A short letter is one ASCII letter, never `h`, and unique within the command.
- A `when`, and every param named in the `when` of a default arm, is a param that exists, with valid values, and never the param itself.

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
- A required `strict` string param that is not the subject is positional. The first bare words fill the positional params in schema order, then the subject takes the rest: `set hint_letters asdf` gives `name` then `value`. A positional param takes its word whatever it says, so a typo reads "name expects one of ...". It shows as `<name>` in the usage line.
- When a command has exactly one number param, a bare number is its subject: `tab.goto 1`, `tab.move -1`, `zoom.set 1.5`. A negative number is a value, never a flag. A command with two number params needs `--name=value` for them.
- A command whose only argument is a required value takes it as the bare subject: `mode ignore`, `cmdline.history prev`, `visual.act yank`. `mode --ignore` works too.
- An enum whose values come from a runtime list, the search engine, is the first bare word, and only when it names an engine: `search arch pacman`. An engine name can hold dots (`search github.repo.issues foo`). `--engine=arch` also works, and the printer writes it only when the bare word would not read back. `--` stops the engine check, so `search -- arch maps` searches the default engine for "arch maps". Build time knows the resolved engine names from `search_engines.toml` plus the built-in `duck`, and the command line from the loaded engines. `tools/build-config` warns about an engine name that starts with `-`, because only `--engine=` can name it.
- An unquoted `@current_url`, `@selection` or `@clipboard` is a context source. The router fills it in when the key is pressed. It works as the subject or after `=`.
- A leading `:` (config only) makes the binding type its command into the command line and wait. `gO = ":open -t @current_url"` shows `open -t https://this.page/...`. The stored file names one param to fill: the one that holds a `@source` (which becomes the prefill), else the `main` param, else the first param. A command with no params cannot take a `:`.
- Unknown flags, a param set twice and an unknown source are errors with a message.
- A param whose `when` condition does not hold is an error with a message, for example "container needs where tab, background or window".
- The printer writes the shortest text that reads back as the same args, with short flags: the engine, then flags in param order, then the subject. It leaves out args equal to the default and adds `--` when the subject would read as a flag. `gO` prefills `open -t `. Docs and the help page use the long form.
- Wording says before, after, previous and next, never left or right, because vertical tab layouts exist.
- The `desertfox run` script uses the same parser.

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
- The modes are normal, insert, ignore, hint, cmdline, caret, visual and line visual. See [Caret and visual](#caret-and-visual). Insert mode follows `focusin` and `focusout` on editable elements instead of checking the focused element on every key.
- In every mode except insert, ignore, hint and cmdline, DesertFox cancels a `/` or `'` keydown that no binding takes, when focus is not in a field. Shift does not matter, but Ctrl, Alt or Meta do. Firefox starts Quick Find on these keys in page content (see [Firefox behavior](firefox-behavior.md#firefox-defaults-not-measured)), and Quick Find competes with DesertFox's own [page search](#page-search). Insert and ignore mode give keys to the page, and hint and cmdline mode own theirs. Every other mode is covered, so a new mode is covered without a change.
- In caret, visual and line visual mode, DesertFox also cancels every other unbound key without Ctrl, Alt or Meta, outside fields. These are reading modes, and a site shortcut (a letter in a mail app, a digit in a video player) moves the user away from the caret. Tab and Shift+Tab, the function keys, Escape, Page Up, Page Down, Home and End still reach the page. So focus moves, Firefox's own keys work, a page dialog closes and the page scrolls. Space and Backspace stay blocked. Every chord passes too, so Ctrl+C copies a selection. Normal mode passes unbound keys, apart from `/` and `'`.
- A mode badge sits in the bottom right corner, 8 px above the bottom edge. The `mode_indicator` setting controls it: `always` (the default), `not_normal` or `off`. The `palette` setting names a theme (default `oasis_moonlight`), see [Themes](#themes). Light or dark follows the system theme.
- The which-key panel is a floating frame with a 1 px tinted border and its title set into the top border. The `which_key_border` setting picks the corners: `square` (the default), `round` or `chamfer`. A footer names the exit keys.
- `browser` mode holds the chords for the Firefox shortcuts. The manifest reserves a fixed number of shortcut slots, and the background assigns the chords to them with `commands.update`. The content script also catches these chords. If it cancels a chord, Firefox does not fire the shortcut as well, which the phase 0 key-blocking page showed.

## Config

The user config is a directory of files, one file per kind of setting. `config.reload` reads them through the native host, and the extension merges and checks them with the same code `tools/build-config` runs. Until managed storage is removed, the merged file that `build-config` writes there still gives the config at startup, before the first `config.reload`.

### Source files

The tool reads `~/.config/desertfox/` by default. Every data file is TOML. A leftover `.jsonc` file is an error that names the `.toml` file to write.

| File | Holds |
| --- | --- |
| `keymap.toml` | Every key: bindings per mode, plus the `search_keys`, `container_keys`, `site_keys` and `modifiers` shortcuts. `""` removes a default binding. |
| `search_engines.toml` | Search engines: a tree of named URL templates with slots (`{query}`, `{repo}`, and others). `%s` still reads as `{query}`. Data only, no keys: the letters of the `s/` group live in `[site_keys]` in `keymap.toml`. The built-in `duck` and `site` need no entry, and an entry with their name replaces them. See [Starting engines](#starting-engines). |
| `command_aliases.toml` | Extra command line names, for example `g = "open.search"`. |
| `settings.toml` | Settings such as the which-key delay and the new tab page. |
| `snippets/*.js` | One custom command per file. See [Snippets](#snippets). |
| `themes/<name>.toml` | A local theme that `palette = "<name>"` picks. See [Themes](#themes). |
| `style.css` | Custom CSS for the DesertFox surfaces. See [Styles](#styles). |

Each data file can also have a matching directory, for example `keymap.d/`. The tool merges the main file first, then the files in the directory in name order. A later entry wins for the same key. This is how private config joins without editing public files: a private repo links `keymap.d/50-private.toml` and `snippets/` files into place.

Every key lives in `keymap.toml`. The other files hold only data. A binding is one line of command text, in the grammar of [Command line syntax](#command-line-syntax), or a list of them that run in order, or a table `{ run = "...", label = "...", intent = "..." }` that names the key for which-key and can replace its hover text (`run` is a string or a list). TOML quotes any key that has symbols, so `"<C-[>"` and `"$"` are quoted and `gx` is not. Two shortcut sections remove most repetition:

```toml
# keymap.toml
[search_keys]                   # sa/Sa, sb/Sb
a = "arch"
b = "brave"

[site_keys]                     # s/i, S/i: the engine of the page's site
i = ["github.issues", "gitlab.issues"]
I = ["github.repo.issues"]

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
- `s/` is the group for the page you are on. Each `[site_keys]` letter lists engines of different sites. On a page the first listed engine whose `hosts` include the page host and whose page slots the page fills runs. Which-key shows a letter only when such an engine exists, so on a GitHub repo page `s/` offers GitHub-wide search and search in this repo, on a user page the GitHub-wide ones, and on an unrelated site nothing. `S/` does the same in a new tab. A member key behaves like `sa`: it searches the selection at once, or opens the command line with the engine typed in. A letter is one key, not `/`, and lists only engines whose `hosts` do not overlap (an engine with no `hosts` overlaps all). `tools/build-config` refuses the rest, and a `search_keys` letter `/` unless the user unbinds both `s//` and `S//`. A row reads the label of the engine the page selects, and which-key hides a letter it cannot resolve. A typed key on a site that fits none refuses with a toast, "No <letter> search for this site".
- `s//` and `S//` search the current site with the built-in `site` engine: the default engine's URL with `site:{host}` added to the query. They show on every page that has a host. The shipped keymap sets the letter `/`, which the build refuses in a user file. If the default engine needs a page slot, `site` uses DuckDuckGo and the load warns. `site` is built when the config loads, so a live `:set default_engine` does not change it.
- `[modifiers]` maps a key inside a group to the args it adds, for example `";r" = { rapid = true, label = "Rapid" }`. The key becomes a group that holds a variant of every other key of the group, with those args added. The `label` names the group. A variant exists only when the command's param schema accepts the args, so an invalid combination is never bound or shown. A key that sets its own `action` gets no variants, and modifiers do not stack. An explicit key at the modifier key wins and the load warns. An explicit key under it wins silently. Normal mode only.
- Containers themselves need no file. Firefox lists their names, colors and icons through `contextualIdentities.query()`, and completion and the `container` param use that list. A name in `container_keys` that does not exist gets a warning at load and is skipped.
- The prefixes for generated bindings (`s` and `S`, `c` and `C`) are settings. An explicit binding in the keymap wins over a generated one.
- A key cannot be both a binding and the start of a longer one, so a user key that extends a default binding (default `sg`, user `sgg`) takes its place: the build drops the default binding and warns once per mode, naming the user keys. A default that a user key replaces includes a binding made by a modifier. The default stays when no extending user key passes the registry check. The build does not check the mode of the extending key, so a user key whose command does not run in its mode still drops the default. This holds for keys from `search_keys` and `container_keys` too. The reverse needs no rule. A user binding shorter than a default group (user `g`, default `gg`) keeps the user key and skips the longer default keys. Two user keys that clash, or two default keys, still skip the longer one with a warning. A vim-style wait on the shorter key is not built, because it adds a pause to every such key.

#### Starting engines

DesertFox has one built-in engine, `duck` (DuckDuckGo), and the `default_engine` setting defaults to it. So clipboard search works with no config. It is added when the config loads and when `tools/build-config` checks names, so the merged file stays as written. An entry named `duck` in `search_engines.toml` replaces the built-in whole. Nothing hides or removes it.

[`examples/engines.toml`](../examples/engines.toml) resolves to 69 engines, `duck` among them, and teaches the tree rules in two worked trees (GitHub and YouTube). Copy it to `~/.config/desertfox/search_engines.toml` and edit it. A TOML file cannot include another file. A `search_engines.d/` file also works, and a later file replaces the table at the same dotted path (a later `[github.repo]` replaces only that node and leaves `github` alone).

#### Engines

An engine is a named URL template. It replaces the former site commands. No provider is built in except `duck`.

- Slots. `{query}` is the typed or selected text, and `%s` means the same. Page slots read the current tab: `{url}`, `{host}`, `{title}`, `{repo}` (GitHub), `{subreddit}` and `{channel}` (YouTube). Each page slot is a small pure function in `src/shared/engines/slots.ts` with its own message for a page that cannot fill it. `{a|b}` takes the first slot that has a value, so `{query|url}` is the typed address, else this page. `{name:raw}` skips escaping, for a path such as `/web/{url:raw}`. Every other value takes `encodeURIComponent`.
- Tree. A table inside an engine is a child, named with a dot (`github.repo.issues`). A child inherits every field and overrides by name. `label` does not inherit: the label is the chain of labels on the path ("GitHub: this repo: issues"), and a `label` field sets one link. A child cannot be named `url`, `label`, `params`, `fallback` or `hosts`, or like a field or param of its parent. A later file replaces the table at one dotted path.
- Params. `[github.params.type]` declares `default`, `values` (name to URL text) and `children = true`, which generates one child per value. A field set to a value name picks it, and `type = { only = [...] }` narrows the values below that level. A hand-written child beats a generated one. A query pair whose whole value is one empty param (`&type=`) is left out.
- Hosts. `hosts = ["github.com"]` lists the host names of the sites an engine belongs to, and children inherit it. A host matches only itself, so `gist.github.com` needs its own entry. It gates only the generated `s/` and `S/` keys: explicit keys and completion ignore it. The build refuses a `hosts` that is not a list of lower-case host names, and one on a node with no url on it or above it.
- Availability. An engine is available on a page only when every page slot in its URL can be filled. Which-key hides the keys of an unavailable engine, and a group left empty. A key still works when typed, and shows the slot message. An engine with `fallback = "<engine>"` never hides and runs the fallback when its slots cannot fill. Snippets can require slots with a `// requires: repo` header. The background filters the key list, so the content script is unchanged.
- Resolution. `tools/build-config` resolves the tree into a flat map keyed by the dotted name and stores it, so the extension only fills page slots and the query. It also writes `<out>.engines.jsonl`, one sorted engine per line, so a config change shows as a diff. It rejects an unknown slot, a param no URL uses, a field that is neither a known field nor a var some URL reads, a value outside the declared list, a fallback to a missing engine, a fallback loop and a default engine that needs a page slot.
- Help. `help` lists the resolved tree with each engine's URL, slots and the file and level that set each field. `engine.show <name>` opens it at that engine.
- Which tool. A result that is a URL is an engine. Page DOM or several steps is a snippet. Browser APIs (tabs, windows, bookmarks, containers) is a built-in command. A fuller real example: [https://github.com/uhs-robert/oasis-dots/blob/main/home/desertfox/.config/desertfox/search_engines.toml](https://github.com/uhs-robert/oasis-dots/blob/main/home/desertfox/.config/desertfox/search_engines.toml).

### Merge and checks

The merged file has one section per kind: `keymap`, `search_engines`, `command_aliases`, `settings`, `snippets` and `css`, plus a format version. The stored keymap holds invocations, so the extension never parses command text. The tool:

- rejects unknown files and unknown sections with a message, so a misspelled file name does not vanish silently. A TOML syntax error names the file, line and column.
- parses every binding string with the registry grammar, then checks it, every alias and every snippet against `commands.json` and reports errors before the extension loads.
- reads snippet code and CSS as text and escapes it, so nobody edits code inside JSON.
- generates a JSON Schema for each data file from `commands.json`, so an editor with TOML schema support (Taplo) completes command names and setting names.

The TOML parser (`smol-toml`) is a dev dependency of the tool only. None of it reaches the extension bundles.

### The settings table

Each setting is one row of data in `src/shared/settings_table.ts`: its kind (true or false, a word from a list, a number, text, a list, a table), the values the kind takes and its default. The check, the expectation text in a problem message, the values the command line offers, the editor JSON Schema, the `Settings` type and the defaults all follow from the row, so a new setting takes one row and one description. A row of kind `custom` (`hint_letters`, `palette`, `new_tab_page`) has its check and expectation written in `settings_schema.ts`. `settable: false` marks a setting that `:set` refuses. Every setting has a default except `home_page`, because `page.home` refuses without one. The editor descriptions live in `settings_docs.ts`, which only the tool imports: the prose is large and no page needs it. The content script reads `src/shared/default_settings.ts`, which `just settings-defaults` writes from the table with one constant per setting, so the content script carries only the defaults it reads. The command line page reads `src/shared/setting_completion.ts` the same way, one row per setting with its name, flags, expectation text and listed values (theme names as of generation), so it bundles neither the table nor the setting rules. The page checks the shape of a line only (`check_args_shape`), and a bad `:set` value shows its error at Enter, from the background. `just test` fails when either generated file is stale, and `just themes` changes the theme names in the second.

### Delivery

`config.reload` (key `qr`) asks the native host for the raw text of the files (`read_config`), builds the config in the background with `build_config` and swaps it in place. Nothing restarts, so the temp edits, the modes and open hints stay.

- The swap runs in the same queue as `set`, `toggle` and `unset`, so a reload and an edit never publish over each other. It replaces the snippet commands (the old ones leave the registry first), compiles and publishes the keymap, tells open tabs (`tree_updated`) and replaces the config the background runs on. Commands that arrive during the swap wait for it to commit. The toast counts every warning Help shows.
- The built config goes to `storage.local` (`desertfox_files_config`), with its build warnings, so Help still lists them after a restart. It wins over managed storage, so a restart, the help page and the new tab page all read what the last reload built. An import will land in the same slot.
- A reload that cannot finish keeps the current config whole: config, snippets, keymap and stored files. Its toast names the cause and the fix: no permission or no host (run `:native.install`), a host error, a missing config folder, or the problems in the files (the first three, and a count).
- The load checks every setting in the files against `SETTING_SPECS`. It drops a setting with an unknown name or a value the check refuses, warns, and lets the layer below apply. `build-config` refuses both, but a hand-edited or older managed file can still hold one.
- Managed storage stays only as the startup config until it is removed. Firefox reads its file once per extension load (see [firefox-behavior.md](firefox-behavior.md), "Managed storage"). A development quirk follows: after one `qr`, `just build-config` and a restart show no change, because the stored files win. The next `qr` shows it.
- `debug.restart` (no key) restarts the whole extension, for debugging. Firefox loads the content script into open tabs by itself after `runtime.reload`, so the reinjection step stays only as a fallback (see [firefox-behavior.md](firefox-behavior.md), "Phase 1 measurements").
- The help page's Home shows the config source, the settings in force, the warnings and the steps to apply an edit, and has no inputs. The settings page at `home.html#/settings` has an input for each setting that `:set` takes. The add-on Preferences button opens the settings page, so no separate options page exists.
- `set`, `toggle` and `unset` change a setting from the browser, with no file edit. The settings in force come from four layers, and a later layer wins: the defaults, the config files, the saved edits and the temp edits. The saved edits live in `storage.local` (`desertfox_saved_settings`) and last until `unset`. The temp edits live in `storage.session` (`desertfox_temp_settings`), and a browser restart clears them. `config.reload` keeps them. `debug.restart` clears them, because Firefox clears `storage.session` when an extension reloads. Both layers are global, private windows included. `set name value` saves a value, `set name` shows it and `toggle name` flips a true or false setting. With `--temp` (`-t`) the change goes to the temp layer. A saved change drops the temp edit of the same name, because that temp edit would keep winning and hide the save. `unset name` drops both edits of a setting, so the config file value applies, and `unset all` drops every edit. `unset --temp` drops only the temp edits. A browser edit wins over the config file, as in qutebrowser, where `autoconfig.yml` holds the browser edits. `name` is a `strict` param of the known setting names, and `value` carries `value_of: "name"`, so `check_args` checks the value with that setting's entry in `SETTING_SPECS`. The two prefix settings are refused, because a live change could collide with other keys. The help page tags every value that differs from the default with its top layer: `settings.toml`, `saved` or `temp`.
- Each change to the saved edits is mirrored to `autoconfig.toml` in the config folder through the host (`write_autoconfig`). The file is write-only: the build skips it and nothing reads it back. A failed write never blocks or undoes the edit. Without the permission it is skipped quietly, and any other failure warns once in the background console.

The background compiles the keymap into a prefix tree and writes it to `storage.local` for the content scripts.

### Styles

Every surface (which-key, the command line, hints and the mode indicator) draws from CSS custom properties, for example `--desertfox-bg-core`, `--desertfox-fg-core`, `--desertfox-primary` (titles and groups), `--desertfox-secondary` (keys), `--desertfox-font` and `--desertfox-radius`. The variables are the stable way to restyle DesertFox. Documented class names use the same `desertfox-` prefix.

- The defaults are declared on an inner element of each surface, not on the shadow host. The host sits in the page, so page CSS can match the host, but a variable set on the host or on `:root` does not reach the inner element, which sets every role token itself. The long prefix and the inner element together keep page CSS out.
- User CSS must name the inner class of a surface to change a variable there, for example `.desertfox-whichkey { --desertfox-primary: #ff6ec7; }`. Variables on `:root` or `:host` alone do not reach inside a surface. The help page lists the classes.
- `style.css` and `style.d/*.css` load after the built-in styles in the shadow roots (hints, which-key, toast, badge) and in the command line, help and new tab pages, after the theme sheet, and follow a reload. Those pages stay hidden until the theme and the user CSS have both been read. Variables set outside DesertFox, on `:root` or in a browser user stylesheet, stay unsupported.
- The background resolves the theme at startup and at every `set`, and stores it as `desertfox_theme` (`{ dark, light }`, the light set already picked by `light_intensity`) in `storage.local`. Each surface turns it into one style block on its inner element, after the built-in styles and before user CSS, and follows `storage.onChanged`, so a `set palette` reaches open pages at once. A surface stays hidden until the first read of the theme and of user CSS returns, and a page stays hidden until the theme read returns, so the default colors never show. A failed read counts as returned. The first hint or which-key panel on a page appears a few ms later, once per page. Light or dark is a `prefers-color-scheme` block.
- Setting variables covers colors, fonts and sizes. Full selectors can change layout. The documented class names on each surface are part of the public format, and the help page lists them.
- In Oasis Dots, the theme switcher writes `style.d/00-oasis-theme.css` with the variables for the current Oasis theme, then runs the reload. Without Oasis, the built-in defaults apply.
- CSS cannot run code. A `url()` in user CSS makes the page load that address, so the CSS stays in the user's own files like the snippets.

### Themes

A theme file maps colors onto a fixed public list of roles. The theme's own color names never reach DesertFox. A file is TOML with a `[dark]` table, a `[light]` table or both, and a file with one table serves both system settings. Each table maps a role to a color: `#rgb`, `#rrggbb`, `rgb()`, `rgba()` with alpha 1 or `hsl()`, stored as `#rrggbb`. Named colors are not accepted.

The 25 roles: `bg_core`, `bg_mantle`, `bg_crust`, `selection`, `fg_core`, `fg_comment`, `fg_dim`, `fg_muted`, `primary`, `secondary`, `accent`, `border`, `error`, `warn`, `ok`, `info`, `mode_normal`, `mode_insert`, `mode_ignore`, `mode_caret`, `mode_visual`, `search_bg`, `search_fg`, `search_current_bg` and `search_current_fg`. `fg_core` is the text, `fg_comment` is secondary text, `fg_dim` is hints such as the command line usage line, and `fg_muted` is disabled text, which has no contrast floor. `error`, `warn`, `ok` and `info` color the toast kinds. A mode badge is its `mode_*` role with `bg_core` as the text. `selection` also paints the selection in visual mode, and caret mode paints one cell in `mode_caret` with `bg_core` text. `mode_caret` is the Neovim cursor color, so the badge and the cell match. The `search_*` pair colors every match of a `/` search and the `f`, `t`, `F` and `T` targets, and the `search_current_*` pair colors the current match. They come from the Neovim `Search` and `CurSearch` groups without the bold, because a CSS `::highlight()` rule cannot set it. The page document has no tokens, so the caret bundle reads these colors from the stored theme. `bg_core`, `fg_core`, `primary` and `accent` are required. Every other role derives from them when missing, by the one table in `src/shared/theme/derive.ts`. A role's CSS variable is `--desertfox-` plus the role with hyphens, for example `--desertfox-bg-mantle`. The list is a contract: a later rename breaks contributed themes, an addition does not. An old name such as `bg`, `fg` or `muted` in a theme file is an unknown role, and the error lists the valid ones.

`palette = "<name>"` looks in `<config dir>/themes/<name>.toml` first, then in the built-in themes. The default is `oasis_moonlight`, and a bare name such as `moonlight` is a config error that lists the known names. A local file wins over a built-in theme of the same name.

The 16 Oasis themes are not TOML. `themes/oasis/` holds byte copies of the oasis.nvim CSS files, one dark file and five light files per theme (`just oasis-themes <oasis.nvim dir>` copies them). `tools/build_themes.ts` reads each role from one named `--oasis-*` variable, with no mixing, and the table of which variable fills which role is at the top of that file. The `light_intensity` setting (1 to 5, default 3) picks the light set of an Oasis theme. Other themes have one light set. `tools/build-config` checks every local theme file and rejects an unknown role (the error lists the valid ones), a missing required role and a bad color, each with the file, table and key. `just themes` compiles `themes/oasis/*.css` and the contributed `themes/*.toml` into `src/shared/themes.ts`, and `just test` fails when that module is stale. The stored theme sets every role token on every surface.

`primary` is the brand color: links, titles, groups, the hint labels (a filled label with `bg_core` text and a 1px primary border). `secondary` colors the keys in which-key and the new tab clock second hand. `accent` marks highlights. A `style.css` that sets or reads `--desertfox-accent` for the brand color moves to `--desertfox-primary`.

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

- `short=` gives a bool or a valued param its flag letter (`short=a`). An enum maps values to letters: `short=tab:t,window:w`. The letter rules are the define-time checks above.
- `modes` is optional. It lists the modes where a key can run the snippet, from `normal`, `caret`, `visual` and `visual_line`. The default is `normal`. Any other name is a build-config error.
- `tools/build-config` turns the header into a normal registry entry. Snippet commands get keys, which-key rows, help, completion and prompts (through an explicit `prompt`) the same as built-in commands.
- The router checks args, then runs the code in the tab's content script with `tabs.executeScript`, with `args` defined. `window.wrappedJSObject` reaches the page's own functions.
- `matches` limits where the command runs. On other pages the router refuses with a message.
- Errors from the code are caught and shown as a message, with the snippet id.
- Snippets have no storage of their own. The code runs in the content script world, so the body's scope hides `browser` and `chrome`. That guards against accidents and is not a sandbox: `globalThis.browser` still reaches the extension APIs, and the code is the user's own.
- A snippet runs other commands with `desertfox.run(command_text)`, which takes the same text as the command line, for example `await desertfox.run("open -t https://example.com")`. It rejects when the command fails. Snippets can call snippets up to 5 levels deep.
- A relative URL in `fetch` resolves against the extension, not the page. Build the address from `location.origin`, for example `fetch(location.origin + "/api/items")`.
- Snippet ids cannot use a group name that DesertFox uses.

The config file is code, so whoever can write it can run code on pages. The file lives in the user's home directory and only the user's own tools write it, so this adds no new access. An import through the help page shows the snippet ids and asks before it stores them.

## Routing

1. The content script catches a trusted `keydown` in the capture phase on `window`, at `document_start`.
2. It walks the prefix tree for the current mode. On a match it cancels the key and its keypress and keyup.
3. It runs a `content` command itself. It sends a `background` command to the background page.
4. The background resolves context sources, checks args and runs the handler. Tab commands act on the tab that is active when they run, never on the tab that was active when the key arrived.

A Firefox shortcut enters at step 4 through `commands.onCommand`.

`.` (`command.repeat`) replays the last request that ran to the end. The router stores it in `storage.session` after every step succeeded, with the count it had. A private window has a slot of its own. Only `background` commands are stored, so `j` then `.` does nothing, and a request that opens the command line stores nothing until the typed command runs. A hint start records itself from the `hints` bundle, so `.` after a hint pick shows hints again with the same action and filter. `3.` replaces the stored count and `.` keeps it. With nothing stored, `.` shows "Nothing to repeat". A pick that opens a link runs as `open.url` marked `from_hints`, which the router does not store, so `.` shows hints and does not reopen the address. A replay re-reads context sources such as the selection and the clipboard, so it uses their values at that time.

The content script must have the keymap before the first key. It reads the compiled prefix tree from `storage.local` at start, buffers keys until the read returns, then replays them. Phase 1 measured that read at 6-10 ms (median 8), so buffering is enough and inline registration is not needed (see [firefox-behavior.md](firefox-behavior.md), "Phase 1 measurements").

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

Completion sources load only when the param being completed needs them: commands, open tabs, bookmarks, search engines, containers, headings and enum values.

`heading` lists the headings of the page, and `;#` opens the line with `heading ` typed. Jumping to a heading is a reading task, not a hint task, so it uses the list and the line's own typing, with no labels. The rows come in page order, each indented by its level counted from the shallowest level on the page (a page without an h1 loses no width) and tagged `h2`, `h3` in the description column. The indent is padding, so the highlight of a fuzzy match still counts the letters of the heading. Typing ranks by the one fuzzy scorer, best match first, and Enter with text and no selected row jumps to the best match. A pick puts `3 Heading text` in the line, and the leading number wins over the text. The heading goes to the top of the view, instantly, and focus, caret and address stay. A page with no heading shows the usual "no match" row. Which headings count is the rule of the hints bundle (`src/content/hints/headings.ts`): h1 to h6 and `role=heading`, by the aria level. A hidden, empty, tiny or clipped heading, and one in a closed `<details>`, gets no row. A heading in a same-origin frame is listed unless the frame is hidden or clipped, and the jump scrolls the frame too. Row text is the rendered text. The headings sit in the page, so the host script answers: the page sends `list_headings` over the port, the host runs `heading.list` in the hints bundle and sends the rows back, with no trip through the background. The bundle keeps the list as a snapshot of elements. The line drops it when it closes, except after Enter, when it drops it once the submitted command has run. A reply that arrives after the line closed is ignored. If the chosen element has left the page at Enter, `heading` refuses with "That heading is gone".

`copylinks` copies the web links of the page as a list, one line per link. `yL` takes the whole page and `yl` only what is in view, both as Markdown. The `scope` param (`page`, `viewport`) and the `format` param (`markdown`, `plain`, `org`) reach the rest from the command line. Only http, https, ftp and file addresses count: mailto, tel, javascript, data and links to a fragment of the same page are dropped. A link counts once, by its absolute address, in page order, and a hidden link is skipped. Its text is the visible text, else the aria-label, the title, the image alt, then the address. The list stops at 500 links. A same-origin frame and a shadow root count, a cross-origin frame does not. The toast says "Copied N links", and an empty list refuses with "No links on this page". The code sits in the hints bundle (`src/content/hints/yank_links.ts`), because the content script has no room for it.

`]i` and `[i` (`page.focus_field`) focus the next or previous form control: text fields, `contenteditable`, selects, checkboxes, radios and every kind of button, in page order. Disabled controls, hidden inputs and controls with no box are skipped, and off-screen ones count. The start is the focused control, else the last one Escape left, else the top of the view (the first control not above it). A count moves that many controls and stops on the last. Past the last or before the first the key shows a notice and leaves focus alone, and it does not wrap. The control takes focus without a scroll and is then centered if it is not fully in view, in each frame that holds it. Insert mode follows the existing `focusin` rule, so a checkbox or a button gets focus and the mode stays normal. The code is in the hints bundle (`src/content/hints/focus_fields.ts`), which reaches shadow roots and same-origin frames. The content script passes the last blurred field along, because the bundle cannot see it. `gi` keeps its own text-field rule in the content script.

Tabs and bookmarks come from the background, because it knows the window and privacy of the line's tab. A string param asks for them with `values: { from: "tabs" }` or `{ from: "bookmarks" }`. The page asks once per kind, keeps the answer for the line and ranks it with the shared scorer on every key. The row list shows "loading" in the note row until the answer lands. Each kind has its own fetch in flight, so kinds do not drop each other. A reply is dropped when the line has closed. The background answers only the frame whose line redeemed a ticket, until the tab closes or navigates or the next line redeems. The frame matters, because any frame of the page can embed its own copy of `cmdline.html`. A normal line lists only normal tabs and a private line only private tabs. Bookmarks list in both.

- A tab row reads `3: GitHub`: the number is the tab's place in its window's tab bar, counted from 1, so it stays while the user types. Picking it puts the number and title in the line. `tab` reads a leading number as that place, and the number wins over the title. Other text is a fuzzy match on title and address, and an equal tie is refused with both tabs named. The `completion_all_windows` setting (default false) lists the tabs of every window. The same number then exists once per window, so the title picks one, else the line's own window.
- `tab.unload` and `tab.load` free and restore a tab's memory (default keys `tu`, `tU`, `tH`, `tL`). They take a subject like `tab`, a `side` and a `count`. Unloading the current tab switches to the alternate tab first, else the next loaded tab, else the previous one. Audible tabs and the active tab of another window are refused, and a side or a count skips pinned tabs. The site of a tab is its site key (`src/shared/site_key.ts`): the host in lower case, with one trailing dot and one leading `www.` dropped and the port ignored, so `www.github.com` is `github.com` and `docs.github.com` is another site, because no public suffix list is used. An IP address and `localhost` are their own keys. All `file:` pages are one site, all `about:` pages are one site (`about:reader` and `view-source:` take the key of the page they wrap), each extension is one site, and `blob:`, `data:`, `javascript:` and unparsable addresses are one `other:` site. `--side=site` (short `S`, on `tab.close`, `tab.unload` and `tab.load`, with no default key) acts on the tab and every unpinned tab of the same site in the line's window. `tab.close` first moves focus to the nearest tab outside the site. A count is invalid with `site` on `tab.unload` and `tab.load`. A count prefix with `tab.close --side=site` is a known gap (it repeats the close), tracked in #187. `tab.load` reloads in place and keeps focus. Both report one line, such as "unloaded 3 tabs, skipped 1 (audible)". In the list, `<C-Space>` (`list.select --action=toggle`) marks or unmarks the highlighted tab row and moves down. The marks are tab ids kept in the line, so filtering keeps them and the actions include hidden marked tabs. A tab that closes drops out, `<Esc>` clears the marks before it does anything else, and they end with the line. `list.act` runs on the marked tabs, or on the highlighted row when none is marked: `<A-x>` closes (the highlight then goes to the first row below the closed rows, else above), `<A-m>` mutes and `<A-p>` pins (any off turns all on, else all off), and `<A-u>` unloads the loaded tabs, or loads all when none is loaded. The ids are fixed at the key press and go to the background in a `tab_rows_action` message that needs the line's ticket, skips ids that no longer name a tab and refuses ids of the other privacy. The list stays open and the rows show the change, with a name dimmed while unloaded. The line's own tab cannot unload this way, because the line lives in it. `<A-c>` (`list.act --action=reopen`) swaps the line to a `container:` prompt over the same line, ranking the containers by name with `default` as one entry. Enter reopens the marked tabs, or the tab that was highlighted when none is marked, in the previewed container, or in the one whose name was typed in full. `<Esc>` returns to the tab list with the marks, filter and highlight kept, and the `<Esc>` order above holds after that. The ids are read when Enter is pressed, so a tab that closed meanwhile drops out. The message carries the container's store id, because names can repeat. The background refuses a private line, an id of the other privacy and a store id it does not know. It leaves out the line's own tab and the tabs already in that container, skips a tab that fails to reopen while the rest go on, and opens no new tab as the active one, because hiding the line's tab ends the line. The note names what moved and what stayed, such as "reopened 2, 1 already there, line tab left out". A private line has no containers, so the prompt refuses there.
- The `cmdline_prompt` setting sets the text before the input. `caret` (the default) shows `> `, bold, in the `secondary` theme role. `colon` shows `:` in the `primary` role, normal weight, with a small gap. Any other value is custom text in the caret style and holds its own trailing space. Every value is 1 to 8 characters on one line.
- The `statusbar_widgets` setting (default `url, scroll, tabs`) lists the widgets on the right of the open command line, in list order. An empty list hides the area. `url` shows the host and path without the scheme, query or fragment, in the `ok` token for https and the `warn` token for http. The label is cut to 30 characters with an ellipsis, so a long path can be partly or fully hidden. The full address is the title. Other schemes get no color, and the widgets do not use the `error` token. `scroll` shows `Top`, `N%` (kept between 1 and 99, so the edges read `Top` and `Bot`, never 0% or 100%), `Bot` or `All` for the page's `scrollingElement`. `tabs` shows `[n/m]`, the tab's place in its window. Each value is a snapshot taken when the line opens and does not change while the user types. The widgets are hidden on `/` and `?` search lines, whose note row shows the match count, and on a line narrower than 30rem.
- A bookmark row shows the title and the address. With no word typed, the list shows the 20 newest. Picking one puts the address in the line. `bookmark` takes an exact address first, then the best fuzzy match, and refuses an equal tie.
- A tab row leads with fixed-width cells, in this order: a status cell (`%` the current tab, `#` the alternate tab, which is the tab the user was on before, then small icons for pinned, audible, muted and discarded), a container mark, a favicon, then the name, the address and the keys. The icons are CSS masks, so they take the text color. The container mark is Firefox's own container icon in the container color, and a colored dot when the icon cannot load. The default container and private tabs have no mark. The favicon is sent only for http, https and data: URLs up to 2048 characters, and a failed load shows a plain glyph. The favicons load from the network when the list opens, for each listed tab, in the command line's tab context (its container and private state), not the listed tab's. `#` is the tab the window was on before its current one, which the background tracks from `tabs.onActivated` in `storage.session`. The `contextualIdentities` lookup fails quietly when containers are off, and then no row has a mark.
- `open` and its tab variants complete from bookmarks and history (`values: { from: "open" }`, `kind: "open"`). The background answers every row, tagged `bm` or `hist`, in the group order of the `open_completion` setting (default `["bookmarks", "history"]`, a source left out is not read), and drops a history row whose address is a bookmark. History comes from `history.search` with all time and up to 1000 entries, minus `about:`, `moz-extension:` and `data:` addresses. A private line lists no history. With no word typed the page shows the 20 newest bookmarks and `history_completion_max` history rows (default 10), a cap that rides in the answer. A typed word ranks every row and keeps the groups in order. A dim `bm` or `hist` cell tells the rows apart. Enter on text that matches no row still opens the address or searches with the default engine. The `history` permission adds an install prompt on update.
- `history` lists only history (`values: { from: "history" }`, `kind: "history"`), newest first, from the same fetch as `open` and with no dedup against bookmarks. A private line gets no rows, and Enter there refuses with "no history in a private window". The answer carries the `history_list_max` cap (default 20) for an empty word, and a typed word ranks every fetched row, so history older than the 1000 newest is not reachable by typing. A pick puts the address in the line. Enter takes an exact address first, then the best match on title and address, and refuses an equal tie. It has no default key and no container flag.
- Engines ride the same fetch (`kind: "engines"`) for the first word of `search`, `--engine=` and `engine.show`. A row shows the engine name and its label. The background marks each engine with a yes or no for whether the line's tab page can fill its slots, and sends no page data. A row the page cannot fill is dimmed and reads "unavailable" in the args column; `engine.show` marks none. A word that ends in a dot (`github.`) lists every engine under that prefix, deeper ones included. The parser still reads a hidden engine, so a picked or typed one runs and the router refuses it.

### Live tab model

The background keeps one map of tab rows (`src/background/tab_model.ts`), built from one `tabs.query` and kept current from tab events. It stores nothing, because one query rebuilds it. Each row carries the tab's site key (`src/shared/site_key.ts`) and a favicon only when the list rule allows it. Changes batch on a 30 ms flush and go to clients on the port `desertfox_tab_model` as a snapshot, then patches (`TabRow` and the messages are in `src/shared/messages.ts`). A patch has `removed` ids, then `upserts`, and the upserts include every row whose index shifted. `rev` counts per port, because a port sees only tabs of its own privacy. A client that sees a gap in `rev` sends `resync` and gets a new snapshot. A `resync` and each new port first read tabs, windows and containers from Firefox again and send any difference from the model as a patch, so a stale or missed event does not last until restart. An event during those reads makes it read again, up to three times. After that the model keeps the rows the events built until the next `resync` or new port. A row also carries its window number (the place in `windows.getAll`, as `tab.attach` counts), whether it is the window's previous tab (the `#` tab, seeded from storage at load), and its container's name, color and icon. Only an extension page may connect. `cmdline.html` is web-accessible, so a web page can frame it, and such a port must also be the frame that redeemed its tab's command line ticket. Other extension pages cannot be framed and skip that check. A page with a sender tab gets that tab's privacy. A page with none (a sidebar) connects as `desertfox_tab_model:normal` or `:private` (the names are in `src/shared/tab_model_port.ts`), and a port that states nothing gets no rows. A tab moving between windows reads as removed until it attaches. The command line `tab` list reads the model: its page opens the port on the first tab read, after it redeemed its ticket, and closes it with the line. Row marks change only when a patch arrives.

### Hints

- Candidates come from one query per filter (all, clickable, buttons, inputs, links, prose, scrollable, media, images): a selector plus an optional test, such as `prose` keeping elements with a text node of their own. The search reaches open shadow roots and, through Firefox's `openOrClosedShadowRoot`, closed ones.
- An IntersectionObserver batch finds visible candidates. An `elementFromPoint` check removes covered ones.
- Labels render in a closed shadow root. All layout reads happen before any write.
- The actions are open, background tab, new window, start caret mode, start visual mode, copy link, copy text, delete element, focus, hover, double-click and, on a video or audio element, play or pause, mute or unmute and fullscreen. Hover sends the pointer events a mouse sends on entering (over, enter and move), from the middle of the element, so a menu or preview that a script opens appears. The next hover, Escape, a hidden tab or another pick ends it, and a pick inside the hovered element keeps it entered. A CSS `:hover` rule does not react, because synthetic events do not set it. Double-click (`;2`, `double_click`) sends the over events, then two presses (pointerdown, mousedown, pointerup, mouseup, click) with click count `detail` 1 and 2, then `dblclick`, all from the middle of the element. The clicks are dispatched events and not `click()`, because `click()` carries no count. The events are untrusted, so a page that checks `isTrusted` ignores them, and Firefox selects no word for them, so on a text node under the middle point the action selects that word with `caretPositionFromPoint` and a word range from `Intl.Segmenter`. A field and a box with no text get no selection change. Links, and elements inside a link, get no label in this mode, because the first click would navigate away. The `links` filter is refused by the `value_when` rule. Rapid mode keeps hints open for several picks. The `media` filter labels visible `video` and `audio` elements, and skips the cover test because site controls lie over a player. `;m` runs `play_pause` on the pick, through the conditional `action` default for `filter=media`. Fullscreen shows the player box, the outermost ancestor with the size of the element, so site controls and subtitles stay, and a second pick leaves fullscreen. A hidden `<audio>` has no box and gets no hint, and a player in a cross-origin iframe is out of reach. The `images` filter labels an `img`, an image button and a box with a CSS background image, each rendered at least 24 px on both sides, and skips the cover test because a card lays a stretched link over its picture. Inline `svg` gets no label, because it has no address. `;I` opens the pick in a new tab, through the conditional `action` default for `filter=images`. Copy and open use the address of the element itself, never an ancestor's: for an image in a link, the `images` filter gives the picture and the `links` filter gives the `href`. An image address is `currentSrc`, then `src`, then a lazy `data-src` resolved against the page, and a web address wins over an inline placeholder. Under the `images` filter a CSS background image wins over the `href` of its own link. A `blob:` address, or a `data:` address over 8 KB, counts as no address. A short `data:` image can be copied but not opened, because Firefox refuses a `data:` URL in `tabs.create` ("Illegal URL", checked in Firefox 159), so open actions skip it and show no label for it. Under another filter, a copy of a picture or media element with no address refuses with "This element has no web address". `;yI` (`copy_image`, images only) copies the picture itself, and the address stays at `hint --images --copy`. The `;d` modifier (`download`, for images, links, media and all) saves the file at the address, so `;dI` saves a picture. Both send the address to the background. A copy fetches it with no Referer and with `credentials: "include"` for a tab in the default container, but with `credentials: "omit"` for a private or container tab, so it never borrows the default cookies. A picture behind a login then refuses in such a tab, and a site that blocks hotlinks refuses everywhere. The fetch times out after 20 seconds. A PNG or JPEG goes to `clipboard.setImageData` unchanged, read by its first bytes. Any other format, SVG included, is drawn and converted to PNG, and a GIF keeps its first frame. A copy over 20 MB is refused, and the read stops at the cap when the server sends no length. A download hands the http, https or `data:` address to `downloads.download` with the tab's private and container context and no forced file name, so the browser fetches it, streams it to disk and honors `Content-Disposition`. It needs the required `downloads` permission. A fetch, conversion, clipboard or download-start failure refuses with a message naming the step, and the clipboard stays as it was. The `frames` filter labels `iframe` and `frame` elements rendered at least 24 px on both sides, visible and uncovered, in the page and in same-origin frames, and never the command line frame. `;f` focuses the pick, through the conditional `action` default for `filter=frames`, with the short flag `-E`. A frame from another site gets its content script on its first focus, so keys act inside it. A frame that already holds the focus when its script loads starts at once. `gF` runs `frame.exit` ("Focus top page"), which sends `focus_page` to frame 0 only, so the top page blurs its own iframe element whatever the frame's origin. It does nothing when the keys are already in the top frame. Open and copy of a frame use `contentDocument.URL` when readable and the `src` otherwise, and refuse with "This element has no web address" for `about:blank`, `srcdoc` and a frame with no `src`. Copying the text of a frame refuses. A frame inside a frame of another site gets no label from the top page: focus the outer frame, then press `;f` again.

### Which-key

Which-key is a first-class surface. After a prefix key, it lists each possible next key with the label of its command. Hovering a row shows the command's intent, or the `intent` of the binding when it has one. It reads both from the registry, so a new command appears without extra work.

The label of a key comes from one rule, applied to the args the binding sets (never the defaults the validator fills in):

- A binding `label` wins. It exists in the TOML table form and on the bindings of the default keymap. On a key that runs several commands, the label sits on the first command. The binding `intent` works the same way for the hover text, and modifier variants do not inherit it.
- A key that sets a container reads as the container name, and the container named `default` reads "Default container".
- Otherwise the label is the command label. A search engine with a label in `search_engines.toml` replaces it (a child engine's label is the chain of labels on its path), and a binding with no engine uses the default engine. Then each `enum` arg the binding sets to a non-default value adds its `value_labels` phrase, in param order ("Open URL in new tab"). A `bool` set to true adds the param name ("Reload hard"). Numbers, free strings and prompted params add nothing, so the keys that set them carry a hand `label` ("Scroll left", "Zoom in a lot"). A phrase that the name of any group above the key already says, as whole words and in any case, is left out: under a group named "Search in new tab", the key reads "Google", not "Google in new tab".
- A snippet key shows the `// label:` header of its snippet.

Two keys in one group may share a label only when they run the same binding (`zi` and `z+`). The unit tests check this for every group of the default keymap and of a copy of the user config, and print each group's labels.

- In the browser it draws in a closed shadow root, styled through the CSS variables in [Styles](#styles). It appears after a delay that is a setting.
- With the native host, it can show in the Quickshell which-key HUD instead. The host writes the rows as `{ "items": [...] }` and calls the `hyprvim_whichkey` IPC target (`open <path>` and `close`). The HUD then uses the current Oasis style. Mouse hover works only in the browser version.

### Caret and visual

Caret mode puts a text cursor in the page, so the user can move through text with vim motions. Visual mode extends a selection with the same motions. Line visual mode (`visual_line`, badge `V-LINE`) selects whole screen lines.

- Caret mode starts at the first visible text, or at a hinted element with `hint.run action=caret`, and visual mode at one with `action=visual`. In normal mode `v` starts caret mode and `V` visual mode. In caret mode `v` starts visual mode and `V` line visual mode. In visual mode `V` switches to line visual mode, and in line visual mode `v` switches to visual mode and `V` returns to caret mode. A switch between the two visual modes keeps both ends of the selection.
- The motions are `h`, `j`, `k`, `l`, `w`, `b`, `e`, `0`, `$`, `gg` and `G`, with count prefixes. The arrow keys move like `h`, `j`, `k` and `l`. The line motions (`j`, `k`, `0`, `^`, `$`) use Firefox's `Selection.modify`, so a wrapped paragraph moves per screen line, and `j` and `k` keep their column. The other motions run on a text model of the visible page, and word motions count letters and digits of any script.
- `f`, `t`, `F` and `T` read the next key as a target character and move to its next match anywhere on the page, exact case. `t` stops before the match and `T` after it. At a line break `t` stops on the last character of the line, because no motion moves off a line break. A count picks the Nth match, and with fewer matches the caret stays. The target is any printable key, even a bound one. Escape cancels the find, and a chord cancels it and then runs. In visual mode the selection end moves. The handler arms a pending state in the caret bundle, and the sink takes the next key.
- After a target, every match on the screen and about a screen around it is lit (the CSS Custom Highlight API, under names of their own so a kept `/` search stays), the match the caret stands at or next to in the stronger color. While they show, `f` and `F` (or `t` and `T`) repeat in their own direction, a count digit before the key repeats it that many times, and `;` and `,` repeat along the last find's direction. Scrolling or resizing lights the new screen. A key of the other family ends the find and starts its own. Escape only ends it. Any other key ends it and then runs as usual, and so does a mode change. `;` and `,` still repeat the last find after the end, without highlights. Which key counts as a find key is the keymap's: the sink ends the find in a microtask unless the `caret.move` handler for a find key ran first in the same key press.
- A line is a screen line, the unit of `j`, `k`, `0` and `$`. Line visual mode keeps the anchor and caret of visual mode, and selects from the start of the screen line of the earlier end to the end of the screen line of the later end. The motions, `/`, `?`, `*`, `#`, `n`, `N`, `o`, `y` and `s` work as in visual mode on that wider selection. `y` adds no line break at the end, because a web page has no line-wise paste.
- In visual mode, `o` swaps the ends of the selection, `y` copies it, and `s` searches it with `open.search` and the `default_engine` setting. Any command whose param defaults to `{ from: "selection" }` uses it. Escape returns to caret mode, then to normal mode.
- The motions are registry commands in the `caret`, `visual` and `visual_line` modes, so keys, which-key and help cover them like any other command.
- Page text inside inputs and text areas belongs to insert mode, not caret mode.

### Page search

- `/` and `?` open the command line as a search line and search the page text as you type. `n` and `N` go to the next and previous match in the direction of the last search, and the last search is kept in register `/`. The code lives in `caret.js`, and `content.js` holds only `find.open`, `find.next` and `find.prev`.
- The search covers the page, open and closed shadow roots and same-origin frames. Text in fields is left out. The query is a regular expression with smartcase: a capital letter makes it exact. A typed space matches a line break. A pattern that is invalid, or that could backtrack without end, is searched as plain text instead, and the line says so.
- Enter keeps the highlights and the match, Escape clears the highlights. Both keep the search and the match as the place `n`, `N` and a new caret or visual session go on from.
- In caret mode `/` and `?` move the caret to the start of the match. Escape on the line leaves the caret where it was. Either way the mode returns to caret mode. `n` and `N` move the caret to the next and previous match.
- In visual mode `/` and `?` move the caret end to the match and keep the anchor. Escape on the line leaves the selection as it was. `n` and `N` do the same with the next and previous match: the caret end goes to the start of the match, so a match before the anchor flips the selection.
- `*` and `#` are `find.open --word` and `find.open --word --backward`. They search the word under the caret, whole and case-sensitive, with no line. In visual mode with a selection they search the selected text. In normal mode the start of the visible text stands in for the caret. They set register `/` like a typed search.
- A `MutationObserver` marks the text model stale when nodes or text change in the page, its shadow roots or its same-origin frames, ignoring the elements DesertFox adds itself. The observer also watches shadow roots and frame documents that held no text when the model was built, and a frame's `load` event counts as a change. A shadow root attached later to an element already on the page fires no event. The model lists the custom elements (a hyphen in the tag name) that had no root at build time, and `n` reads the model again once one has gained a root, open or closed. A plain element that gains a root is not seen until the next `/`. A class or style change that only shows or hides text is not seen, and a new `/` always reads the model again. The next keystroke or `n` reads the model again. The observer starts with the first search.
- A page with more than 4 million characters of text is searched only up to that point, and the line and toast say so.

### Help and palette

The help page is generated from `commands.json` and the live keymap: every command, its params, its keys and the keymap warnings. The palette is the command line with an empty prompt.

The help page has a sidebar of page links on the left. In a window 40rem wide or less, the sidebar is a drawer and never a bar across the page. A bar that stays on top holds a menu button, which opens the drawer over the page. Escape, a picked link, a click outside the drawer or focus leaving it closes the drawer. Opening it focuses the current page's link, and Escape or a click outside returns focus to the menu button. The drawer starts closed on each render and is not stored.

## Native host (optional)

### Config host (built)

A Python 3.9 stdlib-only host in `host/` (see `host/README.md`), separate from the voxcmd host for now. The extension calls it with one-shot `runtime.sendNativeMessage`, and the host exits after its reply. It has two verbs:

- `read_config`: the raw text of every config file under `~/.config/desertfox/`, keyed by relative path. One reply carries all files, and the host returns a clear error above Firefox's 1 MB reply cap. Nothing is parsed host-side.
- `write_autoconfig`: writes the saved browser edits to `~/.config/desertfox/autoconfig.toml`, atomically. Nothing loads that file back. Browser storage stays the only source of saved edits.

The host writes no other file. `nativeMessaging` is an optional permission, requested from a button on the Help page that `:native.install` opens (Firefox grants it only from a click). The page also shows `curl ... | sh` for `host/install.sh`. A release build installs the host of its own version from the GitHub release, checked by SHA-256. A development install takes the host from `main` with no checksum, and `--channel main` forces that. `just release` uploads the host, its checksum and the script. `config.reload` reads the files through it, and each change to the saved edits writes `autoconfig.toml` (see [Delivery](#delivery)).

### Oasis host (planned)

One long-lived port from the background to a host program. The host merges the existing voxcmd Firefox host (`extras/voxcmd-firefox` in the dotfiles), so there is one extension and one host.

The verbs are fixed:

- `tabs`, `activate`, `clear_preface`: the voxcmd verbs, unchanged.
- `list`: the registry as JSON, in the same shape as `hypr-act list`: `{ version, actions: [{ id, label, intent, params, keys, perform }] }`.
- `run`: one invocation from outside, for example from Hyprland, voice or the shell.
- `whichkey_show`, `whichkey_hide`: drive the Quickshell HUD.

Outside callers reach the host through a Unix socket that it opens, because a desktop program cannot open a channel into the extension. A `desertfox list` and `desertfox run <id> [args]` script wraps the socket, the same as `hypr-act`. Oasis can then expose browser commands in its own palette and keymaps.

Firefox keeps the background awake while the port is open, which also helps a later move to MV3.

## Scope

| Phase | Contents |
| --- | --- |
| v1 | Snippets and `config.reload`, with the managed storage config and `tools/build-config`. Normal, insert and ignore modes. Scrolling, back and forward, reload, stop, home, parent and root URL. Tab and window commands, including containers and closed-tab undo. Search engines and explicit prompts. Bookmarks. Hints with every action above, rapid mode included. Copying the URL in 6 formats. Zoom. Search engines with slots and children replace the former site commands (site search, GitHub, subreddit, archive, isdown, translate), which now ship as examples. |
| Later | Marks and quickmarks. The jump list. |
| Dropped | Shell access, string eval, command strings with chaining and pipes, a config language, userChrome editing, rewriting Firefox prefs, an external editor, page-event hooks, a key-grab mode, a theme engine, an update nag, an interactive tutorial, joke commands, a QR code of the URL and view source. |

## Trade-offs

| Choice | Picked | Cost |
| --- | --- | --- |
| MV2 persistent vs MV3 event page | MV2 | Mozilla can remove MV2 some day. The migration is small because state lives in storage. |
| Keymap as data vs as code | Data | None for rebinding. New behavior comes from snippets or a new DesertFox build. |
| Snippets vs plugin extensions | Snippets | Page code only, no extension APIs. A move to MV3 means a rewrite to the `userScripts` API, which shows the user an extra permission warning. |
| Config as JSONC vs Lua | JSONC | No loops or helpers. The `search_keys` and `container_keys` sections remove most repetition, and tools can still edit the files. |
| Config through managed storage vs the native host | The native host. Managed storage stays as the startup config until it is removed | A helper program to install and an optional permission. An edit applies with one key and no restart, so temp edits and modes stay. |
| Command line in an iframe vs a shadow root | iframe | Focus handling is harder. Isolation and direct API access are better. |
| Content script in all frames vs the top frame | All frames. A frame from another site starts its script on its first focus | Hints and keys work inside an embed after `;f` or a click. Ad frames the user never enters stay inert, with one idle focus listener each. |
| Plain `J/K` only vs plus chords | Plus `Alt+J/K` | Two keys for one command. The chord is the only way to switch tabs from about: pages, the PDF viewer or the address bar. |

## Risks

- Keys are lost on a page with no committed document, for example a new tab before its first byte. No extension can fix that. The chords cover it.
- A page that cancels a chord before Firefox sees it blocks the Firefox shortcut. The content script catches the chord first on pages where it runs, so only pages without a content script are exposed.
- Release Firefox needs a signed build for each change in code. The voxcmd extension already has an AMO signing recipe and a policy install, which DesertFox reuses.
- Snippets run code from a config string through `tabs.executeScript`. AMO review of DesertFox can question that. The code comes only from the user's own file, which other extensions with this feature also do.
- Scope creep. The binding map is the scope: a feature not in it needs a reason.

## Roadmap

1. Phase 0, measurements. Done. See [firefox-behavior.md](firefox-behavior.md).
2. Phase 1, core. It covers the registry, `commands.json`, the managed storage config, `tools/build-config`, `config.reload`, keymap validation, the prefix tree, modes, scroll and page commands, tab commands, the shortcut slots and the help page. Exit: every v1 row of the binding map that needs no hints or command line works, and the content script stays under its size target.
3. Phase 2, interfaces. Command line, completion, explicit prompts, hints, which-key, snippets, and caret and visual modes. Exit: the whole v1 column of the binding map works, and DesertFox replaces the current extension in daily use.
4. Command line status area. Done. See [Command line and completion](#command-line-and-completion). `history` is a later widget. `keypress`, `progress`, `scroll_raw`, `text` and `clock` are not planned. `search_match` waits for a page search built on Firefox's find API, because Firefox's find bar hides its count.
5. Phase 3, browser data. Marks, the remaining later rows, and the help page import for users without a shell.
6. Per-site key pass-through. The need: keep some keys off on chosen sites and the rest on, where `ignore_sites` turns off every key. The design is open.
7. Registers, before macros. `"` holds the last yank, `a` to `z` are named, `+` is the clipboard, `_` is the black hole and `/` is the last search. `"ay` yanks into a register, `"ap` pastes from it and `:registers` lists them.
8. Macros, with `.` repeat first. `.` repeats the last command or inserted text. Recording and replay follow: `q<reg>` records into a register, `@<reg>` replays it, a count (`5@q`) or `@@` repeats it. A macro records commands and the text typed in insert mode. Replay inserts text like a paste, not as key events, and stops at the first failed step.
9. Base16 theme importer, after macros.
10. Toolbar click menu and icon. The menu turns DesertFox on and off and opens help. The icon greys out when it is off. The design is open: it does not yet say whether off applies to all sites or one, or how it differs from `ignore_sites`. The icon is a placeholder until a real one with an off state exists.
11. Phase 4, Oasis. The native host merged with voxcmd's, `desertfox list` and `run`, the Quickshell which-key, and the Oasis theme file written on theme change.
12. Phase 4, saved edits on disk. Done: the native host writes the saved edits to a generated `autoconfig.toml` beside the user's files. It never edits the user's own files.
13. Release path. The maintainer installs through `just release` (signed, unlisted) now. A listed addons.mozilla.org release is a later piece: the listing, a source upload, Mozilla review, permission justifications and a privacy note.

## Open questions

- Moving a tab to another window by prompt (old key `wa`) is assumed unused.
- Answered: DesertFox owns the new tab page through `chrome_url_overrides`. `new_tab_page` is a web URL, which the page redirects to, or `desertfox` for the built-in page, and unset means the built-in page. `home_page = "desertfox"` opens the built-in page, even when `new_tab_page` redirects. After Firefox's one-time "Your new tab has changed" notice, its hidden Keep Changes button keeps access key K for that browser session, so Alt+K (previous tab) does nothing on about: pages until a restart. Accepting the notice once avoids it. Firefox still gives the address bar focus on Ctrl+T, so the user presses Esc or clicks the page before keys work. The page loads `content.js`, `ui.js`, `hints.js`, `whichkey.js` and `cmdline.js` by script tag, because `executeScript` cannot reach extension pages. See [`src/newtab/README.md`](../src/newtab/README.md).
- Answered: the built-in new tab page shows a clock and the date. `newtab_clock` is `false` (off), `true` or `"analog"` (a 12 hour analog face with no tick marks, the default) or `"digital"` (seven-segment `HH:mm` in the DSEG7 Classic font, shipped with its OFL text and declared only on this page). `newtab_clock_format` is 12 (default, with an AM or PM suffix) or 24 and applies to the digital clock only. `newtab_date` switches the date off. The page makes no network request. The page colors are var() fallbacks over the theme roles (`bg_core`, `fg_core`, `primary`, `accent`, `bg_mantle`, `border`), so a bare install shows a dark blue page and a theme restyles it once the role variables reach the page.
- Answered: the built-in new tab page can list links, recent tabs and bookmarks. `[[newtab_links]]` in `settings.toml` takes tables of `label`, `url` (http or https only) and an optional `group`, and links with the same group share a list. `:set` refuses it. `newtab_recent_tabs` (open tabs, last used first) and `newtab_bookmarks` (newest added first) are off by default, with `newtab_recent_tabs_max` and `newtab_bookmarks_max` rows, 8 each. The page calls the tab and bookmark APIs itself and reuses the completion's pure readers by import, so it adds no background message. It skips private tabs and lists no tabs on a private page. Every row is an anchor, so hints reach it. Widgets that frame a user-hosted page are rejected, because `file://` cannot be framed and keys and hints do not reach inside frames.
- Answered: the help page has a Quick Start page (`#/quick-start`) of plain text, with no interactive walkthrough. It teaches scrolling, hints, the command line, which-key, page search, caret and visual mode and `g?`, and it reads every key name from the compiled keymap, so a rebind changes the page. The help page loads `hints.js`, `whichkey.js`, `cmdline.js` and `caret.js` by script tag, for the same reason as the new tab page. `runtime.onInstalled` with reason `install` opens the page once, never on an update. The `open_quick_start_on_install` setting (default on) turns that off. A first install has no config, so the setting helps managed setups, where the config is there from the start. A user who builds a config after the first install sees the page once regardless.
- Answered: the `storage.local` read takes 6-10 ms (median 8), so buffering stays and inline registration is not needed. See [firefox-behavior.md](firefox-behavior.md), "Phase 1 measurements".
- Answered: Firefox reloads content scripts into open tabs after `runtime.reload` itself, and the reinjection step stays as a fallback. See [firefox-behavior.md](firefox-behavior.md), "Phase 1 measurements".
