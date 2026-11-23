import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { compile_config } from "../../src/background/compile.ts";
import { create_router } from "../../src/background/router.ts";
import { empty_config } from "../../src/shared/config/config_load.ts";
import { DEFAULT_KEYMAP } from "../../src/shared/keys/default_keymap.ts";
import { resolve_mode_parents } from "../../src/shared/keys/mode_parents.ts";
import type { TreeLeaf } from "../../src/shared/prefix_tree.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { counted_invocations } from "../../src/content/run_content.ts";
import { run_leaf } from "../../src/content/run_leaf.ts";
import type { ContentToBackground } from "../../src/shared/index.ts";
import { make_fake } from "./fakes.ts";

const { compiled } = compile_config({ config: empty_config(), default_keymap: DEFAULT_KEYMAP, get_command: (id) => registry.get(id), enum_sources: { search_engines: [], containers: [] } });
const visual = resolve_mode_parents(compiled.modes, compiled.mode_parents).item_visual!;

// J in visual item mode is the item J (a background step) behind the content step back to item mode, so the page sends the whole leaf to the router.
test("a taken background key goes to the router whole, and the router runs the leave step in the page before the tab switch", async () => {
  const leaf = visual.children["J"] as TreeLeaf;
  const sent: ContentToBackground[] = [];
  await run_leaf(leaf, 2, false, async (message) => (sent.push(message), { ok: true }), () => "item_visual", () => assert.fail("the page runs no step itself"), () => assert.fail());
  assert.equal(sent.length, 1);
  const request = sent[0] as Extract<ContentToBackground, { type: "run" }>;
  assert.deepEqual(request.invocations, counted_invocations(leaf.steps, 2));
  assert.deepEqual(request.invocations.map((invocation) => [invocation.id, invocation.count]), [["mode.set", undefined], ["tab.next", 2]], "the count goes to the item key, not the leave step");
  assert.equal(request.mode, "item_visual");

  const order: string[] = [];
  const { deps } = make_fake(
    {
      "mode.set": { label: "Set mode", intent: "x", params: [{ name: "mode", type: "enum", values: ["item", "item_visual"] }], runs_in: "content" },
      "tab.next": { label: "Next tab", intent: "x", runs_in: "background", count: "repeat", run: () => void order.push("tab.next") },
    },
    { send_to_tab: async (tab_id, message, frame_id) => void order.push(`${tab_id}/${frame_id} ${JSON.stringify(message)}`) },
  );
  const response = await create_router(deps).run({ invocations: request.invocations, mode: request.mode, sender_tab_id: 1, frame_id: 4 });
  assert.deepEqual(response, { ok: true });
  assert.deepEqual(order, [`1/4 ${JSON.stringify({ type: "run_in_content", invocations: [{ id: "mode.set", args: { mode: "item" } }] })}`, "tab.next", "tab.next"]);
});

test("a taken content key runs in the page, the leave step first", async () => {
  const leaf = visual.children["f"] as TreeLeaf;
  const ran: string[][] = [];
  await run_leaf(leaf, undefined, false, async () => ({ ok: true }), () => "item_visual", async (steps) => (ran.push(steps.map((step) => step.invocation.id)), { ok: true }), () => assert.fail());
  assert.deepEqual(ran, [["mode.set", "hint.run"]]);
});
