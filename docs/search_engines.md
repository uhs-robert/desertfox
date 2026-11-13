## Set up your engines

A search engine is a site you can search from the keyboard. Type `search` and your words, or press `s` and the engine's key letter, and DesertFox opens the results. DesertFox has one built-in engine, `duck` (DuckDuckGo), so `search` works from the start. You add every other engine yourself.

### Add engines in the browser

- Open Settings and go to Search engines. Press Add the starter engines to get a set of 66 common engines, including GitHub and YouTube.
- To add one site, fill in a name and an address. Put `{query}` in the address where the search words go. A key letter lets you search it with `s` and that letter.
- Check the table at the end of this page. Every engine you have shows there.

### Add engines from a file

Use a file when you want the full set of features below, or when you keep your setup in files.

- Copy `examples/engines.toml` from the DesertFox repository to `~/.config/desertfox/search_engines.toml`. It holds the same 66 engines.
- Press `,r` in Firefox to load the file. This needs the native host, a small helper program DesertFox installs on Linux. Settings has a button that sets it up.
- Check the table at the end of this page. It shows the file that set each field.

An entry named `duck` in your file replaces the built-in one. A `search_engines.d/` directory next to the file can hold later files. A later file replaces the table at the same dotted path.

### Write an engine

One line is enough for a flat engine. `%s` stands for the typed text.

```toml
arch = { url = "https://wiki.archlinux.org/index.php?search=%s", label = "Arch Linux wiki" }
```

Then `search arch pacman mirrors` searches the wiki. Bind it to a key in the keymap file with `sa = "search arch"`. Add `-t` for a new tab. The `default_engine` setting picks the engine that `search` uses when you name none.

### Slots

A slot is a name in braces that DesertFox fills when it opens the URL.

- `{query}` is the typed or selected text. `%s` means the same.
- `{url}`, `{host}` and `{title}` come from the current page.
- `{repo}`, `{subreddit}` and `{channel}` come from the page when it is a GitHub repository, a subreddit or a YouTube channel.
- `{a|b}` takes the first slot that has a value. `{query|url}` is the typed address, else the current page.
- `{name:raw}` skips escaping, for a path such as `/web/{url:raw}`. Every other value is escaped.

An engine that uses a page slot is available only on a page that can fill it. It hides from which-key and completion on other pages. A typed command still runs and says which slot is missing.

### Fallbacks

Add `fallback = "reddit"` to an engine that needs a page slot. It then never hides. When the page cannot fill the slot, it runs the fallback engine instead.

```toml
[reddit]
label = "Reddit"
url = "https://www.reddit.com/search/?q={query}"

[reddit.sub]
label = "this subreddit"
url = "https://www.reddit.com/r/{subreddit}/search/?q={query}&restrict_sr=1"
fallback = "reddit"
```

Here `search reddit.sub rust` searches the current subreddit, or all of Reddit on any other page.

### Keywords

Add `keyword = "g"` to an engine to give it a short word. A keyword is one to eight lower case letters or digits and is unique across engines. A child does not inherit it, so each engine that wants one sets its own. DesertFox rejects a bad or repeated keyword when it loads the file. The `,,` finder uses the keyword: when the first word of the query is a keyword and a space and more text follow, that engine's search row goes first in the list and is highlighted. Enter searches that engine with the rest, so `g rust` searches Google for `rust`. The match is case-sensitive, and an engine the page cannot fill (see the page slots above) gets no keyword row. `search g rust` still searches the default engine, because the keyword works in the finder only.

```toml
google = { url = "https://www.google.com/search?q=%s", label = "Google", keyword = "g" }
```

### Reading the query back

On a search results page, `s<x>` with nothing selected opens the command line with `search <x> <query on the page>` typed in. Press Enter to search, or edit the text first. This is the default of the `query` param of `search`: the selection, and when there is none, `@search_query`, the query of the results page. A non-empty selection always wins and searches at once. An engine that runs with an empty query (`archive`, which takes the page) never takes the page query. Off a results page the key opens the line empty, as before. You can also type `search arch @search_query` or bind it. A chain is written `@selection,search_query`.

DesertFox reads the query from the page address with the engine's own `url`, in reverse. The page matches an engine when scheme, host and path equal the template's, every fixed query pair of the template is on the page (`type=issues`), and the `{query}` part has a value. The value is decoded, with `+` and `%20` as a space. So every engine with a plain `{query}` reads its own pages and needs nothing more. An engine that uses `{query|url}` or `{query:raw}` reads nothing.

When two engines read the same page, the one whose template has the longest fixed start owns it. A tie goes to the engine with more fixed query pairs, then to the first by name. The built-in `site` engine never owns a page.

For an address the template cannot describe, add `reverse`: a JavaScript regular expression with exactly one capture group, matched against the whole address (it is anchored at both ends for you). It is at most 200 characters, and DesertFox rejects a bad pattern or one with a quantifier on a group: `)` followed by `*`, `+`, `?` or `{` (a group written once is fine). A child does not inherit it.

```toml
wiki = { url = "https://wiki.example/search/%s/results", label = "Wiki", reverse = "https://wiki\\.example/find/([^/]+)" }
```

### Trees

A table inside an engine is a child, named with a dot. `search github.repo.issues foo` runs the `issues` child of `github.repo`.

- A child inherits every field of its parent and overrides by name.
- A label is the chain of labels on the path, such as "GitHub: this repo: issues".
- A param declared on the parent with `children = true` makes one child per value. The example builds `github.issues`, `github.prs` and the rest from one `type` param.
- A value can name a slot with `{name}`, so a scope can say `repo:{repo} `.
- A child cannot be named `url`, `label`, `params`, `fallback`, `hosts`, `keyword` or `reverse`, or like a field or param of its parent.

```toml
[github]
label = "GitHub"
url = "https://github.com/search?q={scope}{query}&type={type}"
scope = ""

[github.params.type]
default = "code"
children = true
values = { code = "code", issues = "issues", prs = "pullrequests" }

[github.repo]
label = "this repo"
scope = "repo:{repo} "
```

### Tips

- Put the one-line engines first in the file. TOML puts a plain key under the table above it.
- DesertFox rejects an unknown slot, a param no URL uses, a fallback to a missing engine and a fallback loop when it loads the file. It tells you what it refused.
- Prefer an engine over a snippet when the result is a URL. Use a snippet when you need the page DOM or several steps.
- Run `engine.show <name>` to open this page at one engine.
- See [a fuller real example](https://github.com/uhs-robert/oasis-dots/blob/main/home/desertfox/.config/desertfox/search_engines.toml).
