// The grab keys on a page with a frame. A drag stays inside one frame: a drag in the top page and a drag inside the frame both land, and a drag from the top page to the frame is refused.
// The page is dragframe in drag_pages.mjs. Its same-origin frame holds the dragin page, which the top page labels with its own walk.

export const areas = ["hints", "keys", "bundles"];

// LAYERS.hints in src/shared/layers.ts, which the test cannot import.
const HINTS_LAYER = 2147483647 - 4;

// The nearest label to an element must sit at its corner. A label further off belongs to another element, such as the frame that holds it.
const MAX_LABEL_GAP_PX = 6;

export async function run_cases({ run_case, open_page, press_keys, in_active_tab, poll_until, hint_label_count, expect, sleep }) {
  // The label nearest to the top-left corner of the element. A frame's element sits at the frame's offset in the top page, where the labels are drawn.
  const label_of = (selector, in_frame = false) =>
    in_active_tab(`(() => {
      const host = [...document.documentElement.children].find((child) => child.getAttribute("data-desertfox-layer") === "${HINTS_LAYER}");
      const frame = document.getElementById("f");
      const origin = ${in_frame} ? frame.getBoundingClientRect() : { left: 0, top: 0 };
      const element = (${in_frame} ? frame.contentDocument : document).querySelector(${JSON.stringify(selector)});
      const at = element.getBoundingClientRect();
      let best, nearest = Infinity;
      for (const label of host.openOrClosedShadowRoot.querySelectorAll(".desertfox-hint")) {
        const box = label.getBoundingClientRect();
        const distance = Math.abs(box.left - (at.left + origin.left)) + Math.abs(box.top - (at.top + origin.top));
        if (distance < nearest) [best, nearest] = [label.textContent, distance];
      }
      return nearest <= ${MAX_LABEL_GAP_PX} ? best : "no label within ${MAX_LABEL_GAP_PX} px of ${selector}, the nearest is " + nearest + " px away";
    })()`);
  const labels_up = (what) => poll_until(what, async () => (await hint_label_count()) > 0);
  const labels_gone = (what) => poll_until(what, async () => (await hint_label_count()) === 0);
  const pick = async (selector, in_frame = false) => {
    await labels_up(`labels for ${selector}`);
    const label = await label_of(selector, in_frame);
    expect(/^[a-z]+$/i.test(label), label);
    await press_keys(label);
    await labels_gone(`labels gone after ${selector}`);
  };
  const got_in_top = () => in_active_tab('document.getElementById("dst").dataset.got ?? ""');
  const got_in_frame = () => in_active_tab('document.getElementById("f").contentDocument.getElementById("fdst").dataset.got ?? ""');
  // The page's tree read comes before the frame loads, so the frame is awaited here.
  const open_frame_page = async (page_id) => {
    await open_page("drag", `dragframe_${page_id}`, { new_tab: true });
    await poll_until("the frame to load", async () => await in_active_tab('(() => { const doc = document.getElementById("f").contentDocument; return doc?.readyState === "complete" && !!doc.getElementById("fdst"); })()'));
  };
  // The refusal shows in a closed shadow root of the hints or the toast layer, so every layer host is searched.
  const notice_seen = (text) =>
    in_active_tab(`[...document.documentElement.children].some((host) => host.openOrClosedShadowRoot?.textContent.includes(${JSON.stringify(text)}))`);

  await run_case(";gg drops in the top page when the page holds a frame", async () => {
    await open_frame_page("top");
    await press_keys(";gg");
    await pick("#src");
    await pick("#dst");
    await poll_until("the drop in the top page", async () => (await got_in_top()) === "top");
    expect((await got_in_frame()) === "", "the frame target got a drop");
  });

  await run_case(";gg inside the frame drops in the frame and not in the top page", async () => {
    await open_frame_page("inside");
    await press_keys(";gg");
    await pick("#fsrc", true);
    await pick("#fdst", true);
    await poll_until("the drop in the frame", async () => (await got_in_frame()) === "frame");
    expect((await got_in_top()) === "", "the top target got a drop");
  });

  await run_case(";gg from the top page to a target in the frame is refused and drops nowhere", async () => {
    await open_frame_page("across");
    await press_keys(";gg");
    await pick("#src");
    await pick("#fdst", true);
    await poll_until("the refusal notice", () => notice_seen("Grab works inside one frame"));
    await sleep(500);
    expect((await got_in_frame()) === "" && (await got_in_top()) === "", "a drop landed across the frame border");
    // After the refusal a new grab on the top page still works.
    await press_keys(";gg");
    await pick("#src");
    await pick("#dst");
    await poll_until("the drop after the refusal", async () => (await got_in_top()) === "top");
  });
}
