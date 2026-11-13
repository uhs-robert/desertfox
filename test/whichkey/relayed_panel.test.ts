import assert from "node:assert/strict";
import { test } from "node:test";
import { create_relayed_panel } from "../../src/content/whichkey/relayed_panel.ts";
import type { WhichKeyPanel } from "../../src/shared/messages.ts";

// The count a document starts from: its start time in ms.
const DOC = 1000;
function fixture() {
  const drawn: string[] = [];
  const relayed = create_relayed_panel(
    (panel) => void drawn.push(`show ${(panel as unknown as { title: string }).title}`),
    () => void drawn.push("hide"),
  );
  const panel = (title: string) => ({ title }) as unknown as WhichKeyPanel;
  return { relayed, drawn, panel };
}

test("a draw that arrives after a newer erase from the same frame is dropped", () => {
  const { relayed, drawn, panel } = fixture();
  relayed.draw_({ from_frame: 5, seq: 1, panel: panel("a") });
  relayed.erase_({ from_frame: 5, seq: 3 });
  relayed.draw_({ from_frame: 5, seq: 2, panel: panel("late") });
  relayed.erase_({ from_frame: 5, seq: 3 });
  assert.deepEqual(drawn, ["show a", "hide"]);
});

test("a frame that loaded a new document draws again though its count starts over, and the old document's late messages are dropped", () => {
  const { relayed, drawn, panel } = fixture();
  relayed.draw_({ from_frame: 5, seq: DOC + 40, panel: panel("old") });
  relayed.erase_({ from_frame: 5, seq: DOC + 41 });
  relayed.draw_({ from_frame: 5, seq: DOC + 2000 + 1, panel: panel("reloaded") });
  relayed.erase_({ from_frame: 5, seq: DOC + 42 });
  assert.deepEqual(drawn, ["show old", "hide", "show reloaded"]);
});

test("an erase from one frame leaves the panel another frame drew", () => {
  const { relayed, drawn, panel } = fixture();
  relayed.draw_({ from_frame: 5, seq: 1, panel: panel("a") });
  relayed.draw_({ from_frame: 6, seq: 1, panel: panel("b") });
  relayed.erase_({ from_frame: 5, seq: 2 });
  relayed.draw_({ from_frame: 5, seq: 3, panel: panel("a again") });
  relayed.erase_({ from_frame: 6, seq: 0 });
  assert.deepEqual(drawn, ["show a", "show b", "show a again"]);
});

test("a message with no count is dropped", () => {
  const { relayed, drawn, panel } = fixture();
  relayed.draw_({ from_frame: 5, panel: panel("a") });
  assert.deepEqual(drawn, []);
});

test("a late erase from a frame never hides the top frame's own panel", () => {
  const { relayed, drawn, panel } = fixture();
  relayed.draw_({ from_frame: 5, seq: 1, panel: panel("a") });
  relayed.show_own_(panel("top"));
  relayed.erase_({ from_frame: 5, seq: 2 });
  assert.deepEqual(drawn, ["show a", "show top"]);
});
