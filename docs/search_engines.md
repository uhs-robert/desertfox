## Set up your engines

A search engine is a named URL template. You type `search arch pacman mirrors` or press a key bound to it, and DesertFox fills the template and opens the result. DesertFox has one built-in engine, `duck` (DuckDuckGo), so `search` works with no config. Every other engine comes from your own file.

### Start with the example

- Copy `examples/engines.toml` from the DesertFox repository to `~/.config/desertfox/search_engines.toml`. It holds 66 engines, including GitHub and YouTube trees.
- Run `just build-config`. The tool only checks the file and prints problems.
- Run `config.reload` (`,r` by default) in Firefox. That loads the file through the native host.
- Check the table below this guide. Your engines show there with the file that set each field.

An entry named `duck` in your file replaces the built-in one. A `search_engines.d/` directory next to the file can hold later files. A later file replaces the table at the same dotted path.

### Write an engine

One line is enough for a flat engine. `%s` stands for the typed text.

```toml
arch = { url = "https://wiki.archlinux.org/index.php?search=%s", label = "Arch Linux wiki" }
```

Then `search arch pacman mirrors` searches the wiki. Bind it to a key in `keymap.toml` with `sa = "search arch"`. Add `-t` for a new tab. The `default_engine` setting picks the engine that `search` uses when you name none.

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

Add `keyword = "g"` to an engine to give it a short word. A keyword is one to eight lower case letters or digits and is unique across engines. A child does not inherit it, so each engine that wants one sets its own. `just build-config` rejects a bad or repeated keyword. The `,,` finder will use the keyword to search an engine from a query such as `g rust`. Until the finder lands the field is only checked and has no effect: `search g rust` still searches the default engine.

```toml
google = { url = "https://www.google.com/search?q=%s", label = "Google", keyword = "g" }
```

### Trees

A table inside an engine is a child, named with a dot. `search github.repo.issues foo` runs the `issues` child of `github.repo`.

- A child inherits every field of its parent and overrides by name.
- A label is the chain of labels on the path, such as "GitHub: this repo: issues".
- A param declared on the parent with `children = true` makes one child per value. The example builds `github.issues`, `github.prs` and the rest from one `type` param.
- A value can name a slot with `{name}`, so a scope can say `repo:{repo} `.
- A child cannot be named `url`, `label`, `params`, `fallback`, `hosts` or `keyword`, or like a field or param of its parent.

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
- Run `just build-config` after each edit to lint it. It rejects an unknown slot, a param no URL uses, a fallback to a missing engine and a fallback loop.
- Prefer an engine over a snippet when the result is a URL. Use a snippet when you need the page DOM or several steps.
- Run `engine.show <name>` to open this page at one engine.
- See [a fuller real example](https://github.com/uhs-robert/oasis-dots/blob/main/home/desertfox/.config/desertfox/search_engines.toml).
