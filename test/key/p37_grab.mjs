// The grab keys. ;gg picks (;ga for a source outside the draggable group) an element and a target and drives a drag between them, ;G holds the element and h j k l, Enter and Escape move, drop and cancel it.
// The pages are in drag_pages.mjs. Each keeps its result in the DOM, which the content script world reads.

export const areas = ["hints", "keys", "bundles"];

// LAYERS.hints in src/shared/layers.ts, which the test cannot import.
const HINTS_LAYER = 2147483647 - 4;

export async function run_cases({ run_case, open_page, press_keys, in_active_tab, in_background, poll_until, hint_label_count, wait_event, find_event, events, expect, sleep }) {
  // The label nearest to the top-left corner of the element.
  const label_of = (selector) =>
    in_active_tab(`(() => {
      const host = [...document.documentElement.children].find((child) => child.getAttribute("data-desertfox-layer") === "${HINTS_LAYER}");
      const at = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      let best, nearest = Infinity;
      for (const label of host.openOrClosedShadowRoot.querySelectorAll(".desertfox-hint")) {
        const box = label.getBoundingClientRect();
        const distance = Math.abs(box.left - at.left) + Math.abs(box.top - at.top);
        if (distance < nearest) [best, nearest] = [label.textContent, distance];
      }
      return best;
    })()`);
  const labels_up = (what) => poll_until(what, async () => (await hint_label_count()) > 0);
  const labels_gone = (what) => poll_until(what, async () => (await hint_label_count()) === 0);
  const pick = async (selector) => {
    await labels_up(`labels for ${selector}`);
    const label = await label_of(selector);
    await press_keys(label);
    await labels_gone(`labels gone after ${selector}`);
  };
  const wait_badge = (mark, page_id, label) => wait_event(mark, (event) => event.type === "indicator" && event.page_id === page_id && event.label === label, `the badge ${label}`);
  const read = (code) => in_active_tab(code);
  const thumb_left = async () => parseFloat(await read('document.getElementById("thumb").style.left || "0"'));
  const order_of = (id) => read(`[...document.getElementById("${id}").children].map((child) => child.id).join()`);

  await run_case(";g drops a draggable element on a target with DragEvents", async () => {
    await open_page("drag", "h5", { new_tab: true });
    await press_keys(";gg");
    await pick("#src");
    await pick("#dst");
    await poll_until("the drop", async () => (await read('document.getElementById("dst").textContent')) === "dropped:payload");
  });

  await run_case(";g reorders a SortableJS list that runs on pointer events", async () => {
    await open_page("drag", "sortable_fallback", { new_tab: true });
    await press_keys(";ga");
    await pick("#i1");
    await pick("#i3");
    await poll_until("the list order", async () => (await order_of("list")) === "i2,i3,i1", { timeout_ms: 5000 });
    const order = await order_of("list");
    expect(order.split(",")[0] === "i2", `the list is ${order}`);
  });

  await run_case(";g moves a pointer slider thumb to a target", async () => {
    await open_page("drag", "range", { new_tab: true });
    await press_keys(";ga");
    await pick("#thumb");
    await pick("#cv");
    await poll_until("the thumb to move", async () => (await thumb_left()) > 100, { timeout_ms: 5000 });
  });

  await run_case(";g still moves a card when the page's setPointerCapture call fails", async () => {
    await open_page("drag", "ptr", { new_tab: true });
    const mark = events.length;
    await press_keys(";gg");
    await pick("#c1");
    await pick("#b");
    await poll_until("the card in column b", async () => (await order_of("b")) === "c1", { timeout_ms: 5000 });
    expect(!!find_event(mark, (event) => event.type === "drag" && event.ev === "capture_error"), "the page's setPointerCapture call did not fail, so the case proves nothing");
  });

  await run_case(";G steps a range input with l, and Enter drops it", async () => {
    const page_id = "range_enter";
    await open_page("drag", "range_enter", { new_tab: true });
    let mark = events.length;
    await press_keys(";Gg");
    await pick("#r");
    await wait_badge(mark, page_id, "GRAB");
    await press_keys("l", "l", "l");
    await poll_until("the value at 3", async () => (await read('document.getElementById("r").value')) === "3");
    mark = events.length;
    await press_keys("-k", "Return");
    await wait_badge(mark, page_id, "NORMAL");
    expect((await read('document.getElementById("r").value')) === "3", "Enter changed the value");
    mark = events.length;
    await press_keys("l");
    await sleep(200);
    expect((await read('document.getElementById("r").value')) === "3", "l still stepped the range after the drop");
  });

  await run_case(";G then Escape leaves a held thumb where it is and no pointer held", async () => {
    const page_id = "range_cancel";
    await open_page("drag", "range_cancel", { new_tab: true });
    await press_keys(";Ga");
    await pick("#thumb");
    await press_keys("l", "l", "l");
    await poll_until("the thumb to move", async () => (await thumb_left()) > 40);
    const held_at = await thumb_left();
    const mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, page_id, "NORMAL");
    await sleep(200);
    expect((await thumb_left()) === held_at, "Escape moved the thumb");
    // A pointer still held would drag the thumb on a later move.
    await read(`(() => { const point = { bubbles: true, clientX: 400, clientY: 40, buttons: 0 }; document.dispatchEvent(new PointerEvent("pointermove", point)); return 0; })()`);
    await sleep(200);
    expect((await thumb_left()) === held_at, "the thumb moved after the cancel");
  });

  await run_case(";G on a range input, Escape restores the value", async () => {
    const page_id = "range_escape";
    await open_page("drag", "range_escape", { new_tab: true });
    await press_keys(";Gg");
    await pick("#r");
    await press_keys("l", "l");
    await poll_until("the value at 2", async () => (await read('document.getElementById("r").value')) === "2");
    const mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, page_id, "NORMAL");
    await poll_until("the value back at 0", async () => (await read('document.getElementById("r").value')) === "0");
  });

  await run_case(";g reorders a SortableJS list in its default, native drag mode", async () => {
    await open_page("drag", "sortable_native", { new_tab: true });
    await press_keys(";ga");
    await pick("#i1");
    await pick("#i3");
    await poll_until("the list order", async () => (await order_of("list")) === "i2,i3,i1", { timeout_ms: 5000 });
  });

  await run_case(";G on a draggable element drops with Enter and drops nothing with Escape", async () => {
    const page_id = "h5_move";
    await open_page("drag", page_id, { new_tab: true });
    let mark = events.length;
    await press_keys(";Gg");
    await pick("#src");
    await wait_badge(mark, page_id, "GRAB");
    await press_keys("j", "j", "j", "j");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, page_id, "NORMAL");
    await sleep(200);
    expect((await read('document.getElementById("dst").textContent')) === "dst", "Escape dropped the element");
    mark = events.length;
    await press_keys(";Gg");
    await pick("#src");
    await wait_badge(mark, page_id, "GRAB");
    await press_keys("j", "j", "j", "j");
    mark = events.length;
    await press_keys("-k", "Return");
    await wait_badge(mark, page_id, "NORMAL");
    await poll_until("the drop", async () => (await read('document.getElementById("dst").textContent')) === "dropped:payload");
  });

  await run_case(";G on the pointer route moves a card into the next column with Enter", async () => {
    const page_id = "ptr_move";
    await open_page("drag", page_id, { new_tab: true });
    let mark = events.length;
    await press_keys(";Gg");
    await pick("#c1");
    await wait_badge(mark, page_id, "GRAB");
    await press_keys("l", "l", "l", "l", "l", "l");
    mark = events.length;
    await press_keys("-k", "Return");
    await wait_badge(mark, page_id, "NORMAL");
    await poll_until("the card in column b", async () => (await order_of("b")) === "c1");
  });

  await run_case("a page that goes hidden during ;G releases the held pointer through the mode exit", async () => {
    await open_page("drag", "range_hidden", { new_tab: true });
    await press_keys(";Ga");
    await pick("#thumb");
    await press_keys("l", "l", "l");
    await poll_until("the thumb to move", async () => (await thumb_left()) > 40);
    const held_at = await thumb_left();
    await open_page("field", "grab_other", { new_tab: true });
    const in_hidden_tab = (code) =>
      in_background(`(async () => { const [tab] = await browser.tabs.query({ url: "*://*/drag?id=range_hidden*" }); return (await browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }))[0]; })()`);
    await sleep(500);
    // A pointer still held would drag the thumb on a later move.
    await in_hidden_tab('document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 400, clientY: 40 })); 0');
    await sleep(200);
    expect(parseFloat(await in_hidden_tab('document.getElementById("thumb").style.left || "0"')) === held_at, "the thumb moved after the page went hidden");
  });

  await run_case(";g drops a link on an html5 drop zone, though a link has no draggable attribute", async () => {
    await open_page("drag", "link_drop", { new_tab: true });
    await press_keys(";ga");
    await pick("#src");
    await pick("#dst");
    await poll_until("the drop", async () => (await read('document.getElementById("dst").textContent')) === "dropped");
  });

  await run_case(";gg labels the draggable group, one per sign, and not links, plain buttons or a child of a grab cursor", async () => {
    await open_page("drag", "group", { new_tab: true });
    await press_keys(";gg");
    await labels_up("labels of the draggable group");
    expect((await hint_label_count()) === 12, `the draggable group has twelve labels, one per sign, got ${await hint_label_count()}`);
    await press_keys("-k", "Escape");
    await labels_gone("labels gone after Escape");
  });

  await run_case(";ga keeps every element reachable, the link, the button and the plain div too", async () => {
    await open_page("drag", "group_every", { new_tab: true });
    await press_keys(";ga");
    await labels_up("labels of every element");
    expect((await hint_label_count()) >= 5, "every filter labels the link, the button and the div too");
    await press_keys("-k", "Escape");
    await labels_gone("labels gone after the second Escape");
  });

  await run_case(";gg reorders a native SortableJS list whose items are marked draggable", async () => {
    await open_page("drag", "sortable_marked", { new_tab: true });
    await press_keys(";gg");
    await pick("#i1");
    await pick("#i3");
    await poll_until("the list order", async () => (await order_of("list")) === "i2,i3,i1", { timeout_ms: 5000 });
  });

  await run_case(";gg drags a role=slider div shaped like a video volume panel", async () => {
    await open_page("drag", "slider", { new_tab: true });
    await press_keys(";gg");
    await pick("#vol");
    await pick("#dst");
    await poll_until("the slider value", async () => parseFloat(await read('document.getElementById("vol").getAttribute("aria-valuenow")')) > 20, { timeout_ms: 5000 });
  });

  await run_case(";Gg labels the two touch-action cards, holds one and Escape puts it back", async () => {
    const page_id = "ptr_hold";
    await open_page("drag", page_id, { new_tab: true });
    let mark = events.length;
    await press_keys(";Gg");
    await labels_up("labels of the draggable group");
    expect((await hint_label_count()) === 2, `the two cards are the whole group, got ${await hint_label_count()} labels`);
    await pick("#c1");
    await wait_badge(mark, page_id, "GRAB");
    expect(!!find_event(mark, (event) => event.type === "drag" && (event.ev === "capture_ok" || event.ev === "capture_error")), "the card got no pointerdown, so nothing was held");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, page_id, "NORMAL");
    // The page's pointerup appends the dragged card to the column under the pointer, so the card lands last in column a and never in b.
    expect((await order_of("a")) === "c2,c1" && (await order_of("b")) === "", `Escape put the card back in column a, a is ${await order_of("a")} b is ${await order_of("b")}`);
  });

  await run_case(";gg twice on one page lands both drops", async () => {
    await open_page("drag", "ptr_twice", { new_tab: true });
    await press_keys(";gg");
    await pick("#c1");
    await pick("#b");
    await poll_until("c1 in column b", async () => (await order_of("b")) === "c1", { timeout_ms: 5000 });
    await press_keys(";gg");
    await pick("#c2");
    await pick("#b");
    await poll_until("c2 in column b after c1", async () => (await order_of("b")) === "c1,c2", { timeout_ms: 5000 });
  });

  const vol_now = async () => parseFloat(await read('document.getElementById("vol").getAttribute("aria-valuenow")'));
  await run_case(";Gg on a position-reading slider: no jump on grab, [ steps finer, Escape leaves the value where it is", async () => {
    const page_id = "abs_slider";
    await open_page("drag", page_id, { new_tab: true });
    let mark = events.length;
    await press_keys(";Gg");
    await pick("#vol");
    await wait_badge(mark, page_id, "GRAB");
    await sleep(200);
    expect((await vol_now()) === 80, `the grab moved the slider to ${await vol_now()}`);
    await press_keys("h");
    await poll_until("one step left", async () => (await vol_now()) === 56);
    await press_keys("[", "h");
    await poll_until("a half step left", async () => (await vol_now()) === 44);
    await press_keys("]", "]", "l");
    await poll_until("a double step right", async () => (await vol_now()) === 92);
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, page_id, "NORMAL");
    await sleep(300);
    expect((await vol_now()) === 92, `Escape moved the slider to ${await vol_now()}`);
  });

  await run_case(";G Escape on the pointer route moves nothing after the nudges", async () => {
    await open_page("drag", "abs_slider", { new_tab: true });
    await press_keys(";Gg");
    await pick("#vol");
    await press_keys("h", "h");
    await poll_until("two steps left", async () => (await vol_now()) === 32);
    await press_keys("-k", "Escape");
    await sleep(300);
    expect((await vol_now()) === 32, `Escape moved the slider to ${await vol_now()}`);
  });

  await run_case(";G on a range input ignores [ and ] and keeps its native step", async () => {
    await open_page("drag", "range_enter", { new_tab: true });
    await press_keys(";Gg");
    await pick("#r");
    await press_keys("]", "]", "l", "l");
    await poll_until("the value at 2", async () => (await read('document.getElementById("r").value')) === "2");
    await press_keys("-k", "Escape");
    await poll_until("the value back at 0", async () => (await read('document.getElementById("r").value')) === "0");
  });

  await run_case(";G on an html5 source takes [ and ] and Escape drops nothing", async () => {
    const page_id = "h5_step";
    await open_page("drag", page_id, { new_tab: true });
    let mark = events.length;
    await press_keys(";Gg");
    await pick("#src");
    await wait_badge(mark, page_id, "GRAB");
    await press_keys("]", "j", "[", "j");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, page_id, "NORMAL");
    await sleep(200);
    expect((await read('document.getElementById("dst").textContent')) === "dst", "Escape dropped the element");
  });

  // A cancelled grab hint leaves the next hint on the page whole. Escape goes as `-k`: a bare "Escape" types the letters E s c a p e, which pick a label.
  for (const [second, label] of [[";ga", "a grab"], [";a", "a plain hint"]]) {
    await run_case(`;gg then Escape, and ${second} on the same page still shows labels (${label})`, async () => {
      await open_page("drag", "group", { new_tab: true });
      await press_keys(";gg");
      await labels_up("labels of the draggable group");
      await press_keys("-k", "Escape");
      await labels_gone("labels gone after Escape");
      await sleep(300);
      await press_keys(second);
      await labels_up(`labels of ${second} after the cancelled grab`);
      await press_keys("-k", "Escape");
      await labels_gone(`labels gone after ${second}`);
    });
  }
}
