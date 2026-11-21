// The event orders in which a late or stray step of a media or item hold used to end or miss a live hold. Each test drives one order through both modes on one shared step queue, the way the background wires them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { create_step_queue } from "../../src/background/tab_steps.ts";
import { create_tab_item } from "../../src/background/tab_item.ts";
import { create_tab_media } from "../../src/background/tab_media.ts";
import type { Mode } from "../../src/shared/command.ts";

type HoldMode = "media" | "item";
type Step = { mode: HoldMode; on: boolean; frame: number | "all"; from?: number; document?: string };

const settle = () => new Promise((resolve) => setImmediate(resolve));

// Tab 4, whose frames take the steps the background sends. Each step stays on its way until the test lands it, and a step to a frame in `frozen` never answers. A step that names a document lands only on that document of its frame, as Firefox refuses a send to a document another one replaced. Frame N starts with document `dN`.
function tab_with_holds({ frozen = [] as number[] } = {}) {
  const data: Record<string, unknown> = {};
  // While `reads_held` is set, each storage read waits until the test releases the reads.
  let reads_held: Promise<void> | undefined;
  let release_reads = () => {};
  const hold_reads = () => void (reads_held = new Promise<void>((resolve) => (release_reads = () => ((reads_held = undefined), resolve()))));
  const storage = {
    get: async (key: string) => {
      await reads_held;
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    set: async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items)),
    remove: async (key: string | string[]) => void [key].flat().forEach((name) => delete data[name]),
  } as never;
  const documents = new Map<number, string>();
  const document_of = (frame: number) => documents.get(frame) ?? `d${frame}`;
  const sent: Step[] = [];
  const on_way: { step: Step; land: () => void }[] = [];
  // Each landed step with the document of its frame that took it, so a step for an old document shows when it reaches the new one.
  const landed: (Step & { took?: string })[] = [];
  const sender =
    (mode: HoldMode) =>
    (_tab_id: number, on: boolean, frame_id?: number, from?: number, document_id?: string): Promise<unknown> => {
      const step: Step = { mode, on, frame: frame_id ?? "all", ...(from !== undefined && { from }), ...(document_id !== undefined && { document: document_id }) };
      sent.push(step);
      if (frame_id !== undefined && frozen.includes(frame_id)) return new Promise(() => {});
      return new Promise<void>((resolve, reject) =>
        on_way.push({
          step,
          land: () => {
            if (frame_id !== undefined && document_id !== undefined && document_of(frame_id) !== document_id) return reject(new Error("no such document"));
            landed.push({ ...step, ...(frame_id !== undefined && { took: document_of(frame_id) }) });
            resolve();
          },
        }),
      );
    };
  const steps = create_step_queue();
  const item = create_tab_item({ storage, send_step: sender("item"), steps });
  const media = create_tab_media({ storage, send_step: sender("media"), steps, frame_alive: async () => true, set_timer: () => undefined, clear_timer: () => {}, now: () => 0 });
  // A mode report of a frame of tab 4, from its current document. `by_step` says a step put the frame in the mode.
  const report = (hold: HoldMode, frame: number, mode: Mode, by_step = false) =>
    hold === "item" ? item.reported(4, frame, mode, by_step, document_of(frame)) : media.reported(4, frame, mode, true, by_step, document_of(frame));
  // Lands the oldest step on its way that matches.
  const land = async (match: Partial<Step> = {}) => {
    const index = on_way.findIndex(({ step }) => Object.entries(match).every(([key, value]) => step[key as keyof Step] === value));
    assert.notEqual(index, -1, `a step ${JSON.stringify(match)} is on its way`);
    on_way.splice(index, 1)[0]!.land();
    await settle();
  };
  const land_all = async () => {
    while (on_way.length > 0) await land();
  };
  // Whether the frame ends in the mode after every step that landed on it.
  const final_on = (frame: number, hold: HoldMode) => landed.filter((step) => step.mode === hold && (step.frame === frame || (step.frame === "all" && step.from !== frame))).at(-1)?.on;
  const hold_of = (hold: HoldMode) => data[`desertfox_tab_${hold}_4`] as { frames: number[] } | undefined;
  const reload = (frame: number, document: string) => void documents.set(frame, document);
  // A report from a sender that names no document, as a hold stored before documents were kept has none.
  const report_without_document = (hold: HoldMode, frame: number, mode: Mode, by_step = false) => (hold === "item" ? item.reported(4, frame, mode, by_step) : media.reported(4, frame, mode, true, by_step));
  return { hold_reads, release_reads: () => release_reads(), item, media, steps, report, report_without_document, land, land_all, sent, landed, final_on, hold_of, reload, document_of };
}

const MODES: HoldMode[] = ["item", "media"];

// R1. Frame 0 leaves hold A, so A ends and its off step to frame 0 goes out. Before it lands, frame 0 starts hold B on its own. The off then lands, frame 0 drops to normal and reports it, which must not end B.
for (const hold of MODES) {
  test(`${hold}: an off step on its way to a frame that starts a new hold on its own steps the frame back on and keeps the hold`, async () => {
    const tab = tab_with_holds();
    await tab.report(hold, 0, hold);
    await tab.land({ on: true });
    await tab.report(hold, 7, hold, true);
    await tab.report(hold, 7, "normal", true);
    assert.ok(tab.sent.at(-1)?.frame === 0 && !tab.sent.at(-1)?.on, "A's off to frame 0 is on its way");
    await tab.report(hold, 0, hold);
    await tab.land({ on: false, frame: 0 });
    await tab.report(hold, 0, "normal");
    await tab.land_all();
    assert.deepEqual(tab.hold_of(hold)?.frames, [0], "hold B lives");
    assert.equal(tab.final_on(0, hold), true, "frame 0 is back in the mode");
  });
}

// R1, the other side: once the stale off has been spent, a real Escape in that frame ends the hold as before.
for (const hold of MODES) {
  test(`${hold}: after the stale off steps the frame back on, its next normal report ends the hold`, async () => {
    const tab = tab_with_holds();
    await tab.report(hold, 0, hold);
    await tab.land({ on: true });
    await tab.report(hold, 7, hold, true);
    await tab.report(hold, 7, "normal", true);
    await tab.report(hold, 0, hold);
    await tab.land({ on: false, frame: 0 });
    await tab.report(hold, 0, "normal");
    await tab.land_all();
    await tab.report(hold, 0, hold, true);
    await tab.report(hold, 0, "normal");
    assert.equal(tab.hold_of(hold), undefined);
  });
}

// R2 and R5. Hold A ends and its off step to child frame 7 goes out. Frame 7 loads a new document, which joins hold B through its keymap read before the off lands. The off was for the old document and must not reach the new one.
for (const hold of MODES) {
  test(`${hold}: an off step on its way to a child frame's old document never reaches the document that replaced it`, async () => {
    const tab = tab_with_holds();
    await tab.report(hold, 0, hold);
    await tab.land({ on: true });
    await tab.report(hold, 7, hold, true);
    await tab.report(hold, 0, "normal");
    await tab.report(hold, 0, hold);
    tab.reload(7, "d7-new");
    assert.equal(await (hold === "item" ? tab.item.join(4, 7, "d7-new") : tab.media.join(4, 7, "d7-new")), true);
    await tab.land_all();
    assert.deepEqual(
      tab.landed.filter((step) => step.frame === 7 && !step.on),
      [],
      "no off lands on frame 7",
    );
    assert.deepEqual(tab.hold_of(hold)?.frames, [0, 7]);
  });
}

// R5 at a load. The offs to the old page go out straight away and may land after the new top document started the mode.
for (const hold of MODES) {
  test(`${hold}: the off steps of a load never reach the new page's documents`, async () => {
    const tab = tab_with_holds();
    await tab.report(hold, 0, hold);
    await tab.land({ on: true });
    await tab.report(hold, 7, hold, true);
    if (hold === "item") await tab.item.navigated(4, { status: "loading" });
    else await tab.media.navigated(4, { status: "loading" });
    tab.reload(0, "d0-new");
    await tab.report(hold, 0, hold);
    await tab.land_all();
    assert.deepEqual(
      tab.landed.filter((step) => step.took === "d0-new" && !step.on),
      [],
    );
  });
}

// R3. A step of one mode still on its way when the other mode starts: a frame in item mode takes a media step and the other way round, so the late step must land first.
test("a media start waits for an item step still on its way, so the late item step cannot land after it", async () => {
  const tab = tab_with_holds();
  await tab.report("item", 0, "item");
  await tab.media.enter(4, 0);
  assert.deepEqual(
    tab.sent.map((step) => `${step.mode} ${step.on ? "on" : "off"} ${step.frame}`),
    ["item on all"],
    "the media step waits",
  );
  await tab.land_all();
  assert.deepEqual(
    tab.landed.map((step) => step.mode),
    ["item", "media"],
  );
});

test("an item start waits for a media step still on its way", async () => {
  const tab = tab_with_holds();
  await tab.media.enter(4, 0);
  await tab.report("item", 0, "item");
  assert.deepEqual(
    tab.sent.map((step) => step.mode),
    ["media"],
  );
  await tab.land_all();
  assert.deepEqual(
    tab.landed.map((step) => step.mode),
    ["media", "item"],
  );
});

// R6. One frame of the hold never answers its off step. The other frames of the same end get theirs.
for (const hold of MODES) {
  test(`${hold}: a frame that never answers holds up no off step of the same end to another frame`, { timeout: 2000 }, async () => {
    const tab = tab_with_holds({ frozen: [5] });
    await tab.report(hold, 0, hold);
    await tab.land({ on: true });
    for (const frame of [5, 7, 9]) await tab.report(hold, frame, hold, true);
    await tab.report(hold, 0, "normal");
    await tab.land_all();
    assert.deepEqual(
      tab.landed.filter((step) => !step.on).map((step) => step.frame),
      [7, 9],
    );
  });
}

// R6, the order contract the lanes keep: a step to one frame still waits for an earlier step to every frame, and a step to every frame waits for every earlier step.
test("a step to one frame waits for an earlier step to every frame, and a step to every frame waits for one to a frame", async () => {
  const tab = tab_with_holds();
  await tab.report("item", 0, "item");
  await tab.report("item", 7, "item", true);
  await tab.report("item", 0, "normal");
  assert.deepEqual(tab.sent.length, 1, "the off to frame 7 waits for the step on to every frame");
  await tab.land();
  assert.deepEqual(tab.sent.at(-1), { mode: "item", on: false, frame: 7, document: "d7" });
  await tab.media.enter(4, 0);
  assert.equal(tab.sent.length, 2, "the media step to every frame waits for the off to frame 7");
  await tab.land_all();
  assert.deepEqual(
    tab.landed.map((step) => `${step.mode} ${step.frame}`),
    ["item all", "item 7", "media all"],
  );
});

// The queue keeps an entry per tab only while the tab has steps, so a closed tab, or a report after its close, leaves nothing behind.
test("the queue holds no entry for a tab whose steps all landed or whose tab closed", async () => {
  const steps_by_tab = new Map();
  const queue = create_step_queue(steps_by_tab);
  const answers: (() => void)[] = [];
  const send = () => new Promise<void>((resolve) => answers.push(resolve));
  const mode = queue.for_mode(send);
  mode.step(4, true);
  mode.step(4, false, 7);
  answers.shift()!();
  await settle();
  answers.shift()!();
  await settle();
  assert.equal(steps_by_tab.size, 0, "drained");
  mode.step(5, true);
  mode.step(5, false, 7);
  mode.clear(5);
  assert.equal(steps_by_tab.size, 0, "cleared at the close, the step on its way included");
  // A report that comes in after the close sends one more step.
  mode.step(5, false, 7);
  while (answers.length > 0) {
    answers.shift()!();
    await settle();
  }
  assert.equal(steps_by_tab.size, 0, "a report after the close leaves nothing either");
});

// A load or a close of the tab, as the background's listeners run it: one reset of the tab's steps, then each mode ends its hold.
const load_page = async (tab: ReturnType<typeof tab_with_holds>) => {
  tab.steps.reset(4);
  await Promise.all([tab.media.navigated(4, { status: "loading" }), tab.item.navigated(4, { status: "loading" })]);
};
const close_tab = async (tab: ReturnType<typeof tab_with_holds>) => {
  tab.steps.reset(4);
  await Promise.all([tab.media.forget(4), tab.item.forget(4)]);
};

// A media step on its way and an item step to every frame waiting behind it. The first mode to clear its steps must not set the other mode's step free to reach the new page.
for (const [name, end_of_page] of [
  ["load", load_page],
  ["close", close_tab],
] as const) {
  test(`a ${name} sends no waiting step of either mode, whichever mode clears first`, async () => {
    const tab = tab_with_holds();
    await tab.media.enter(4, 0);
    await tab.report("item", 0, "item");
    assert.equal(tab.sent.length, 1, "the item step waits behind the media step");
    await end_of_page(tab);
    await tab.land_all();
    // The load's offs to the old page name its documents, so none reaches the new page.
    assert.deepEqual(
      tab.sent.slice(1).filter((step) => step.on || step.document === undefined),
      [],
    );
  });
}

// An off for the old document of a frame cannot land on its new one, so the new document's own start is no stale start, and its first Escape ends the hold.
for (const hold of MODES) {
  test(`${hold}: a frame's new document that starts the mode while an off to its old one is on its way ends the hold with its first Escape`, async () => {
    const tab = tab_with_holds();
    await tab.report(hold, 0, hold);
    await tab.land({ on: true });
    await tab.report(hold, 7, hold, true);
    await tab.report(hold, 0, "normal");
    assert.deepEqual(tab.sent.at(-1), { mode: hold, on: false, frame: 7, document: "d7" });
    tab.reload(7, "d7-new");
    await tab.report(hold, 7, hold);
    await tab.report(hold, 7, "normal");
    assert.equal(tab.hold_of(hold), undefined);
  });
}

// A step still waiting for a frame when its new document joins was for the old document. With no document on record, only the drop at the join keeps it from the new one.
for (const hold of MODES) {
  test(`${hold}: a step still waiting for a child frame when its new document joins never goes out`, async () => {
    const tab = tab_with_holds();
    await tab.report_without_document(hold, 7, hold);
    await tab.land({ on: true });
    await tab.report_without_document(hold, 0, hold, true);
    await tab.report_without_document(hold, 0, "normal");
    await tab.report_without_document(hold, 7, hold);
    await tab.land({ on: false, frame: 7 });
    await tab.report_without_document(hold, 7, "normal");
    assert.deepEqual(tab.sent.at(-1), { mode: hold, on: true, frame: "all", from: 7 }, "the step back on to frame 7 waits behind this one");
    const sent_before_join = tab.sent.length;
    assert.equal(await (hold === "item" ? tab.item.join(4, 7) : tab.media.join(4, 7)), true);
    await tab.land_all();
    assert.deepEqual(tab.sent.slice(sent_before_join), []);
  });
}

// R1 with a slow read: the report of the frame's own start arrives while the off is on its way, and the off lands while the background still reads the hold. The report came first, so the off is still stale.
for (const hold of MODES) {
  test(`${hold}: an off that lands while the report of a frame's own start waits on its storage read still counts as stale`, async () => {
    const tab = tab_with_holds();
    await tab.report(hold, 0, hold);
    await tab.land({ on: true });
    await tab.report(hold, 7, hold, true);
    await tab.report(hold, 7, "normal", true);
    tab.hold_reads();
    const own_start = tab.report(hold, 0, hold);
    await tab.land({ on: false, frame: 0 });
    tab.release_reads();
    await own_start;
    await tab.report(hold, 0, "normal");
    await tab.land_all();
    assert.deepEqual(tab.hold_of(hold)?.frames, [0], "hold B lives");
    assert.equal(tab.final_on(0, hold), true, "frame 0 is back in the mode");
  });
}
