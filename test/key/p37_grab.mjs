// The grab keys. ;g picks an element and a target and drives a drag between them, ;G holds the element and h j k l, Enter and Escape move, drop and cancel it.
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
    await press_keys(";g");
    await pick("#src");
    await pick("#dst");
    await poll_until("the drop", async () => (await read('document.getElementById("dst").textContent')) === "dropped:payload");
  });

  await run_case(";g reorders a SortableJS list that runs on pointer events", async () => {
    await open_page("drag", "sortable_fallback", { new_tab: true });
    await press_keys(";g");
    await pick("#i1");
    await pick("#i3");
    await poll_until("the list order", async () => (await order_of("list")) === "i2,i3,i1", { timeout_ms: 5000 });
    const order = await order_of("list");
    expect(order.split(",")[0] === "i2", `the list is ${order}`);
  });

  await run_case(";g moves a pointer slider thumb to a target", async () => {
    await open_page("drag", "range", { new_tab: true });
    await press_keys(";g");
    await pick("#thumb");
    await pick("#cv");
    await poll_until("the thumb to move", async () => (await thumb_left()) > 100, { timeout_ms: 5000 });
  });

  await run_case(";g still moves a card when the page's setPointerCapture call fails", async () => {
    await open_page("drag", "ptr", { new_tab: true });
    const mark = events.length;
    await press_keys(";g");
    await pick("#c1");
    await pick("#b");
    await poll_until("the card in column b", async () => (await order_of("b")) === "c1", { timeout_ms: 5000 });
    expect(!!find_event(mark, (event) => event.type === "drag" && event.ev === "capture_error"), "the page's setPointerCapture call did not fail, so the case proves nothing");
  });

  await run_case(";G steps a range input with l, and Enter drops it", async () => {
    const page_id = "range_enter";
    await open_page("drag", "range_enter", { new_tab: true });
    let mark = events.length;
    await press_keys(";G");
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

  await run_case(";G then Escape puts a held thumb back and leaves no pointer held", async () => {
    const page_id = "range_cancel";
    await open_page("drag", "range_cancel", { new_tab: true });
    await press_keys(";G");
    await pick("#thumb");
    await press_keys("l", "l", "l");
    await poll_until("the thumb to move", async () => (await thumb_left()) > 40);
    const mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, page_id, "NORMAL");
    await poll_until("the thumb back at the start", async () => (await thumb_left()) < 1);
    // A pointer still held would drag the thumb on a later move.
    await read(`(() => { const point = { bubbles: true, clientX: 400, clientY: 40, buttons: 0 }; document.dispatchEvent(new PointerEvent("pointermove", point)); return 0; })()`);
    await sleep(200);
    expect((await thumb_left()) < 1, "the thumb moved after the cancel");
  });

  await run_case(";G on a range input, Escape restores the value", async () => {
    const page_id = "range_escape";
    await open_page("drag", "range_escape", { new_tab: true });
    await press_keys(";G");
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
    await press_keys(";g");
    await pick("#i1");
    await pick("#i3");
    await poll_until("the list order", async () => (await order_of("list")) === "i2,i3,i1", { timeout_ms: 5000 });
  });

  await run_case(";G on a draggable element drops with Enter and drops nothing with Escape", async () => {
    const page_id = "h5_move";
    await open_page("drag", page_id, { new_tab: true });
    let mark = events.length;
    await press_keys(";G");
    await pick("#src");
    await wait_badge(mark, page_id, "GRAB");
    await press_keys("j", "j", "j", "j");
    mark = events.length;
    await press_keys("-k", "Escape");
    await wait_badge(mark, page_id, "NORMAL");
    await sleep(200);
    expect((await read('document.getElementById("dst").textContent')) === "dst", "Escape dropped the element");
    mark = events.length;
    await press_keys(";G");
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
    await press_keys(";G");
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
    await press_keys(";G");
    await pick("#thumb");
    await press_keys("l", "l", "l");
    await poll_until("the thumb to move", async () => (await thumb_left()) > 40);
    await open_page("field", "grab_other", { new_tab: true });
    const in_hidden_tab = (code) =>
      in_background(`(async () => { const [tab] = await browser.tabs.query({ url: "*://*/drag?id=range_hidden*" }); return (await browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }))[0]; })()`);
    await poll_until("the thumb back at the start", async () => parseFloat(await in_hidden_tab('document.getElementById("thumb").style.left || "0"')) < 1);
    // A pointer still held would drag the thumb on a later move.
    await in_hidden_tab('document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 400, clientY: 40 })); 0');
    await sleep(200);
    expect(parseFloat(await in_hidden_tab('document.getElementById("thumb").style.left || "0"')) < 1, "the thumb moved after the page went hidden");
  });
}
