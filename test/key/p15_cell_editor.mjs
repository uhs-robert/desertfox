// Key cases for a cell editor that always holds the focus: it takes typing only while a cell is being edited.
// /cell_editor stands in for Google Sheets. Its editor is parked off screen with no width until an edit starts, and no focus event marks the start or the end of an edit.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "config"];

export async function run_cases({ config_copy, load_config_dir, setup, run_case, press_keys, open_page, expect, poll_until, in_active_tab, events, wait_event, expect_no_scroll, scroll_delta_by_press, scroll_of }) {
  const page_id = "p15_cell_editor";
  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const editor_text = () => in_active_tab(`document.getElementById("waffle-rich-text-editor").textContent`);
  const editor_holds_focus = () => in_active_tab(`document.activeElement.id === "waffle-rich-text-editor"`);
  async function expect_badge(label) {
    let seen;
    await poll_until(`the ${label} badge`, async () => (seen = await badge()) === label, { timeout_ms: 3000, expected_timeout: true }).catch(() => expect(false, `the badge is ${seen}, expected ${label}`));
  }
  const page_sees = (mark, key, seen_page_id = page_id) => wait_event(mark, (event) => event.type === "keydown" && event.key === key && event.page_id === seen_page_id, `the page to see ${key}`);
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

  // The body of such a frame keeps the focus through Escape, so a key re-check that forced the mode to match the focus would undo the Escape.
  for (const [kind, what] of [["body_editor_frame", "a contenteditable body"], ["design_mode_frame", "a designMode document"]]) {
    await run_case(`Escape leaves insert mode in a frame with ${what}, and the next key stays a normal mode key`, async () => {
      const top_id = `p15_${kind}`;
      const frame_id = `${top_id}_frame`;
      const frame_text = () => in_active_tab(`document.getElementById("inner").contentDocument.body.textContent`);
      await open_page(kind, top_id, { new_tab: true, keys_page_id: frame_id });
      await expect_badge("INSERT");
      const text_before = await frame_text();
      await press_keys("-k", "Escape");
      await expect_badge("NORMAL");
      const mark = events.length;
      await press_keys("j");
      await wait_event(mark, scroll_of(frame_id), `j to scroll the frame with ${what}`);
      await expect_badge("NORMAL");
      expect((await frame_text()) === text_before, `j was typed into the frame with ${what}`);
    });
  }

  // escape_to_page: the pages with this id prefix get the row, the page above gets none.
  await setup("load a config with an escape_to_page row for the p15_escape_ pages", async () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), '\n[[site_rules]]\nsite = "*://127.0.0.1/*?id=p15_escape_*"\nescape_to_page = true\n');
    await load_config_dir(dir);
  });

  const start_edit_by_enter = async (seen_page_id = page_id) => {
    const mark = events.length;
    await press_keys("-k", "Return");
    await page_sees(mark, "Enter", seen_page_id);
    await expect_badge("INSERT");
  };

  await run_case("without an escape_to_page row, Escape in a cell edit is swallowed and the edit stays", async () => {
    await open_page("cell_editor", page_id, { new_tab: true });
    await start_edit_by_enter();
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    // DesertFox took the Escape and blurred the editor, so the page never saw it.
    expect((await in_active_tab(`document.getElementById("box").style.top`)) === "100px", "the page ended the edit on a swallowed Escape");
  });

  await run_case("with an escape_to_page row, Escape reaches the page, ends the edit and returns to normal mode", async () => {
    const row_page_id = "p15_escape_row";
    await open_page("cell_editor", row_page_id, { new_tab: true });
    await start_edit_by_enter(row_page_id);
    const mark = events.length;
    await press_keys("-k", "Escape");
    await page_sees(mark, "Escape", row_page_id);
    await expect_badge("NORMAL");
    expect(await editor_holds_focus(), "the cell editor lost the focus when Escape ended the edit");
    expect((await in_active_tab(`document.getElementById("box").style.top`)) === "-10000px", "the edit did not end");
  });

  await run_case("with an escape_to_page row, Escape in a plain input reaches the page and insert mode stays", async () => {
    const row_page_id = "p15_escape_plain";
    await open_page("cell_editor", row_page_id, { new_tab: true });
    await in_active_tab(`document.getElementById("plain").focus(); 0`);
    await expect_badge("INSERT");
    const mark = events.length;
    await press_keys("-k", "Escape");
    await page_sees(mark, "Escape", row_page_id);
    await expect_badge("INSERT");
  });

  await run_case("<A-Escape> sends Escape to the page from insert mode on a page with no row", async () => {
    await open_page("cell_editor", page_id, { new_tab: true });
    await start_edit_by_enter();
    const mark = events.length;
    await press_keys("-M", "alt", "-k", "Escape", "-m", "alt");
    await wait_event(mark, (event) => event.type === "keydown" && event.key === "Escape" && event.page_id === page_id, "the page to get the sent Escape");
    await expect_badge("NORMAL");
    expect((await in_active_tab(`document.getElementById("box").style.top`)) === "-10000px", "the sent Escape did not end the edit");
  });
}
