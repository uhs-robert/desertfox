// The "Locked pages" column of docs/keymap.md: the normal keys that stay in the browser module's tree when the default config compiles.

import { compile_config } from "../../src/background/compile.ts";
import type { DefaultSiteRow } from "../../src/background/default_site_rows.ts";
import type { ScopeNode } from "../../src/shared/browser_module_protocol.ts";
import { locked_page_command_ids, scope_tree_of } from "../../src/shared/browser_module_scope.ts";
import { empty_config } from "../../src/shared/config/config_load.ts";
import type { KeymapConfig } from "../../src/shared/keymap.ts";
import { parse_sequence } from "../../src/shared/keys/notation.ts";
import type { Registry } from "../../src/shared/registry/index.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";
import type { LockedKeys } from "./render.ts";

export function locked_keys(keymap: KeymapConfig, site_rows: readonly DefaultSiteRow[], registry: Registry): LockedKeys {
  const { compiled } = compile_config({ config: empty_config(), default_keymap: keymap, default_site_rows: site_rows, get_command: (id) => registry.get(id), enum_sources: {} });
  const tree = scope_tree_of(compiled, locked_page_command_ids(registry.list()), (id, args) => {
    const command = registry.get(id);
    const checked = command && check_args(command, args);
    return checked?.ok ? checked.args : undefined;
  });
  return (key) => {
    const { tokens, error } = parse_sequence(key);
    if (error !== undefined) return false;
    let node: ScopeNode | undefined = tree;
    // A key that waits for one more key (`q<key>`) reaches its leaf through the empty token.
    for (const token of [...tokens, ""]) {
      if (typeof node !== "object" || !("children" in node)) break;
      node = node.children[token];
    }
    return node !== undefined && (typeof node === "string" || "native" in node);
  };
}
