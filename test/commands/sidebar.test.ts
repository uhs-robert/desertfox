import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { SIDEBAR_COMMAND_IDS } from "../../src/shared/browser_module_protocol.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const ctx: CommandContext = { tab_id: 1, window_id: 1, frame_id: 0, mode: "normal" };

test("the registry defines exactly the commands the browser module runs, in the sidebar mode and out of the command line list", () => {
  const defined = registry.list().filter((command) => command.id.startsWith("sidebar.")).map((command) => command.id);
  assert.deepEqual(defined.sort(), [...SIDEBAR_COMMAND_IDS].sort());
  for (const id of SIDEBAR_COMMAND_IDS) {
    const command = registry.get(id)!;
    assert.deepEqual(command.modes, ["sidebar"], id);
    assert.equal(command.completion, "hidden", id);
    assert.equal(command.params, undefined, id);
    assert.equal(command.bridge, false, id);
    assert.match(command.name ?? "", /^sidebar_[a-z_]+$/, id);
  }
});

test("each sidebar command refuses in the extension, which has no focus in the sidebar", async () => {
  for (const id of SIDEBAR_COMMAND_IDS) {
    const command = registry.get(id)!;
    assert.equal(command.runs_in, "background", id);
    await assert.rejects(async () => command.run!(ctx, {}), (error: unknown) => error instanceof RuntimeRefusal && error.message === "Works only with focus in the sidebar", id);
  }
});
