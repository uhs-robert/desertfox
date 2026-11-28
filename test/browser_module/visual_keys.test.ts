import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";
import { BROWSER_MODULE_PROTOCOL_VERSION } from "../../src/shared/browser_module_protocol.ts";
import { locked_page_command_ids, scope_tree_of } from "../../src/shared/browser_module_scope.ts";
import { empty_config } from "../../src/shared/config/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/shared/keys/default_keymap.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import { COMMANDS_FILE, create_firefox, key_event, source_of } from "./fake_firefox.ts";

const TREE = scope_tree_of(
  compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, default_site_rows: DEFAULT_SITE_ROWS, get_command: (id) => registry.get(id), enum_sources: {} }).compiled,
  locked_page_command_ids(registry.list()),
  (id, args) => {
    const command = registry.get(id);
    const checked = command && check_args(command, args);
    return checked?.ok ? checked.args : undefined;
  },
);
const CARET = "accessibility.browsewithcaret";

// The default tree's v, V and gV, typed as keys through the committed commands bundle on a parent-process about: page. It fails when the bundle is stale: its copy of the command list refuses the tree.
function typed(...keys: string[]) {
  const firefox = create_firefox({ extra_files: { [COMMANDS_FILE]: source_of(COMMANDS_FILE), "desertfox-visual.js": source_of("desertfox-visual.js") } });
  firefox.start_extension();
  const window = firefox.make_window();
  window.load();
  const tab = window.add_tab();
  window.select(tab.tab);
  firefox.write_state({ v: BROWSER_MODULE_PROTOCOL_VERSION, enabled: true, keys: [], tabs: {}, tree: TREE });
  const text = { nodeType: 3 };
  const selection = { rangeCount: 0, isCollapsed: true, collapse() { this.rangeCount = 1; }, modify(alter: string) { if (alter === "extend") this.isCollapsed = false; } };
  const document = { activeElement: null, defaultView: { innerWidth: 800, innerHeight: 600, getSelection: () => selection, addEventListener() {}, removeEventListener() {} }, caretPositionFromPoint: () => ({ offsetNode: text, offset: 0 }) };
  Object.assign(tab.browser, { currentURI: { scheme: "about" }, contentWindow: { document } });
  for (const key of keys) window.press(key_event(key, { target: tab.browser, originalTarget: tab.browser }));
  return { firefox, selection };
}

test("v enters caret mode through the key path", () => {
  assert.equal(typed("v").firefox.read_pref(CARET), true);
});

test("V enters visual mode through the key path, and gV caret mode", () => {
  const visual = typed("V");
  assert.equal(visual.firefox.read_pref(CARET), true);
  assert.equal(visual.selection.isCollapsed, false);
  assert.equal(typed("g", "V").firefox.read_pref(CARET), true);
});
