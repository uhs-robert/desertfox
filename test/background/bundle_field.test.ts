import assert from "node:assert/strict";
import { test } from "node:test";
import { make_router_deps } from "../../src/background/browser_deps.ts";
import { compile_config } from "../../src/background/compile.ts";
import { empty_config } from "../../src/background/config_load.ts";
import { create_router } from "../../src/background/router.ts";
import type { TreeLeaf } from "../../src/shared/prefix_tree.ts";
import { make_fake } from "./fakes.ts";

// A lazy command has a bundle and no run. Dropping the field on any path to the page makes the page refuse the command.
const lazy_commands = {
  "find.next": { label: "Next match", intent: "x", runs_in: "content" as const, count: "repeat" as const, bundle: "caret" as const },
};

test("the compiled step of a lazy command keeps its bundle", () => {
  const { registry } = make_fake(lazy_commands);
  const config = { ...empty_config(), keymap: { normal: { n: { id: "find.next" } } } };
  const { compiled } = compile_config({ config, default_keymap: {}, get_command: (id) => registry.get(id), enum_sources: { search_engines: [], containers: [] } });
  const leaf = compiled.modes.normal!.children.n as TreeLeaf;
  assert.equal(leaf.steps[0]!.bundle, "caret");
});

test("a repeated lazy command sends every invocation with its bundle", async () => {
  const sent: unknown[] = [];
  const { deps } = make_fake(lazy_commands, { send_to_tab: async (_tab, message) => void sent.push(message) });
  await create_router(deps).run({ invocations: [{ id: "find.next", count: 3 }], mode: "normal", sender_tab_id: 1 });
  const invocations = (sent[0] as { invocations: { id: string; bundle?: string }[] }).invocations;
  assert.deepEqual(invocations.map((invocation) => [invocation.id, invocation.bundle]), [["find.next", "caret"], ["find.next", "caret"], ["find.next", "caret"]]);
});

test("the command line opens through an invocation that names its bundle", async () => {
  const sent: unknown[] = [];
  Object.defineProperty(globalThis, "browser", { value: { tabs: { sendMessage: async (_tab: number, message: unknown) => void sent.push(message) } }, configurable: true });
  await make_router_deps(async () => empty_config(), {} as never).open_cmdline(1, 0, "open ");
  assert.deepEqual(sent, [{ type: "run_in_content", invocations: [{ id: "cmdline.open", args: { text: "open " }, bundle: "cmdline" }] }]);
});
