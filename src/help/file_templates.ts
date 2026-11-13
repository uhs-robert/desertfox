// The text a new file starts with: a few commented lines that show the shape, and change nothing until the user edits them.

const TEMPLATES: [RegExp, string][] = [
  [/^keymap(\.d\/.*)?\.toml$/, '# One table per mode. A key is a command line text; "" removes a default key.\n[normal]\n# gx = "tab.close"\n'],
  [/^search_engines(\.d\/.*)?\.toml$/, '# An engine is a named address. {query} is the typed text.\n# [mine]\n# url = "https://example.com/search?q={query}"\n# keyword = "m"\n'],
  [/^command_aliases(\.d\/.*)?\.toml$/, '# An extra command line name for a command.\n# g = "open.search"\n'],
  [/^quickmarks(\.d\/.*)?\.toml$/, '# One letter or digit and an address.\n# g = "https://github.com"\n'],
  [/^settings(\.d\/.*)?\.toml$/, "# Any setting from the list above, for example:\n# hint_letters = \"asdf\"\n"],
  [/^themes\//, '# A theme. Pick it with the theme setting. A [light] table works the same way.\n[dark]\nbg_core = "#1a1b26"\nfg_core = "#c0caf5"\nprimary = "#7aa2f7"\naccent = "#bb9af7"\n'],
  [/^style(\.d\/.*)?\.css$/, "/* Your CSS for DesertFox pages. */\n"],
  [/^snippets\//, "// id: user.my_snippet\n// label: My snippet\n// intent: Say what it does.\n// matches: https://example.com/*\n"],
];

export function template_for(path: string): string {
  return TEMPLATES.find(([shape]) => shape.test(path))?.[1] ?? "";
}
