// Key cases for a cell editor that always holds the focus: it takes typing only while a cell is being edited.
// /cell_editor stands in for Google Sheets. Its editor is parked off screen with no width until an edit starts, and no focus event marks the start or the end of an edit.
export const areas = ["keys"];

export async function run_cases({ run_case, press_keys, open_page, expect, poll_until, in_active_tab, events, wait_event, expect_no_scroll, scroll_delta_by_press }) {
  const page_id = "p15_cell_editor";
  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const editor_text = () => in_active_tab(`document.getElementById("waffle-rich-text-editor").textContent`);
  const editor_holds_focus = () => in_active_tab(`document.activeElement.id === "waffle-rich-text-editor"`);
  async function expect_badge(label) {
    let seen;
    await poll_until(`the ${label} badge`, async () => (seen = await badge()) === label, { timeout_ms: 3000, expected_timeout: true }).catch(() => expect(false, `the badge is ${seen}, expected ${label}`));
  }
  const page_sees = (mark, key) => wait_event(mark, (event) => event.type === "keydown" && event.key === key && event.page_id === page_id, `the page to see ${key}`);
  async function expect_j_scrolls(when) {
    expect((await scroll_delta_by_press(page_id, ["j"])) > 0, `j did not scroll ${when}`);
    expect((await editor_text()) === "", `the parked editor holds "${await editor_text()}" ${when}`);
  }
  async function expect_j_is_typed(when) {
    const mark = events.length;
    await press_keys("j");
    await page_sees(mark, "j");
    await poll_until(`the editor to hold the typed j ${when}`, async () => (await editor_text()) === "j");
    await expect_no_scroll(mark, page_id);
  }

  await run_case("a parked cell editor that holds the focus leaves the page in normal mode", async () => {
    await open_page("cell_editor", page_id, { new_tab: true });
    expect(await editor_holds_focus(), "the cell editor does not hold the focus after load");
    await expect_badge("NORMAL");
    await expect_j_scrolls("while the editor is parked");
  });

  await run_case("the key that starts an edit switches to insert mode on its keyup", async () => {
    const mark = events.length;
    await press_keys("-k", "Return");
    await page_sees(mark, "Enter");
    // The edit starts in the page's own keydown listener, after the content script's. Only the keyup re-check can see it before another key.
    await expect_badge("INSERT");
    await expect_j_is_typed("in an edit started by Enter");
  });

  await run_case("the key that ends an edit switches back to normal mode on its keyup", async () => {
    const mark = events.length;
    await press_keys("-k", "Return");
    await page_sees(mark, "Enter");
    await expect_badge("NORMAL");
    expect(await editor_holds_focus(), "the cell editor lost the focus when the edit ended");
    await expect_j_scrolls("after Enter ended the edit");
  });

  await run_case("the first key of an edit started with no key goes to the editor", async () => {
    await in_active_tab(`document.getElementById("cell").dispatchEvent(new MouseEvent("dblclick")); 0`);
    // No key and no focus event told the content script about the edit, so only the keydown re-check keeps this j from scrolling.
    await expect_j_is_typed("in an edit started with no key");
    await expect_badge("INSERT");
  });

  await run_case("the first key after an edit ended with no key is a normal mode key", async () => {
    await in_active_tab(`document.getElementById("cell").dispatchEvent(new MouseEvent("click")); 0`);
    await expect_j_scrolls("after the edit ended with no key");
    await expect_badge("NORMAL");
  });
}
