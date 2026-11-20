import assert from "node:assert/strict";
import { test } from "node:test";
import { content_handlers } from "../src/content/handler_map.ts";
import { run_in_order } from "../src/content/run_content.ts";

// A section jump that lands nowhere answers a failed outcome, and the arrow pair that `item_select` adds behind it must not run.
test("a step that answers failed stops the steps behind it", async () => {
  const ran: string[] = [];
  const handlers = content_handlers as Record<string, unknown>;
  handlers["test.fails"] = { run: () => (ran.push("fails"), { ok: false, message: "No next section" }) };
  handlers["test.arrow"] = { run: () => void ran.push("arrow") };
  try {
    const outcome = await run_in_order([{ id: "test.fails" }, { id: "test.arrow" }] as never);
    assert.deepEqual([outcome, ran], [{ ok: false, message: "No next section" }, ["fails"]]);
  } finally {
    delete handlers["test.fails"];
    delete handlers["test.arrow"];
  }
});
