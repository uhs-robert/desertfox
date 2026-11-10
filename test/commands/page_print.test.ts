import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { registry } from "../../src/shared/registry/builtin.ts";

const CTX: CommandContext = { tab_id: 7, window_id: 3, frame_id: 0, mode: "normal" };
const globals = globalThis as Record<string, unknown>;

function stub(save_result = "saved") {
  const calls: { call: string; args: unknown[] }[] = [];
  globals.browser = {
    tabs: {
      print: (...args: unknown[]) => void calls.push({ call: "print", args }),
      saveAsPDF: async (...args: unknown[]) => (calls.push({ call: "saveAsPDF", args }), save_result),
    },
  };
  return calls;
}

test("page.print opens the print window on the active tab", async () => {
  const calls = stub();
  await registry.get("page.print")!.run!(CTX, {});
  assert.deepEqual(calls, [{ call: "print", args: [] }]);
});

test("page.save_pdf passes empty page settings and accepts saved, replaced and canceled", async () => {
  for (const result of ["saved", "replaced", "canceled"]) {
    const calls = stub(result);
    await registry.get("page.save_pdf")!.run!(CTX, {});
    assert.deepEqual(calls, [{ call: "saveAsPDF", args: [{}] }], result);
  }
});

test("page.save_pdf refuses when Firefox could not write the file", async () => {
  for (const result of ["not_saved", "not_replaced"]) {
    stub(result);
    await assert.rejects(async () => registry.get("page.save_pdf")!.run!(CTX, {}), RuntimeRefusal, result);
  }
});

test("neither command is repeatable, so a dialog never replays", () => {
  for (const id of ["page.print", "page.save_pdf"]) assert.equal(registry.get(id)!.repeatable, false, id);
});
