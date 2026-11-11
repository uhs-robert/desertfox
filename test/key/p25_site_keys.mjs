// A site row's `bind` column sends page keys: h, j, k and l become arrow keydowns on the element the row names. The shipped Sheets rows match docs.google.com only, so this piece uses rows of its own on local pages and the headed run on real Sheets covers the shipped row.
// The page gets an element with the id Sheets uses that records the key code of each keydown it receives.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "config", "bundles"];

const arrow = (key, key_code) => `{ id = "page.send_key", args = { key = "${key}", key_code = ${key_code}, target = "#waffle-rich-text-editor" } }`;
const ARROWS = `h = ${arrow("ArrowLeft", 37)}, j = ${arrow("ArrowDown", 40)}, k = ${arrow("ArrowUp", 38)}, l = ${arrow("ArrowRight", 39)}`;
const ctrl_key = (key, key_code) => `{ id = "page.send_key", args = { key = "${key}", key_code = ${key_code}, ctrl = true, target = "#waffle-rich-text-editor" } }`;
const PAGE_DOWN = arrow("PageDown", 34);

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  await setup("load a config with bind rows for the sheets_ pages", async () => {
    const dir = config_copy();
    appendFileSync(
      join(dir, "settings.toml"),
      [
        "",
        "[[site_rules]]",
        'site = "*://127.0.0.1/*?id=sheets_over*"',
        `bind = { j = ${PAGE_DOWN} }`,
        "[[site_rules]]",
        'site = "*://127.0.0.1/*?id=sheets_*"',
        `bind = { ${ARROWS}, gg = ${ctrl_key("Home", 36)}, G = { run = ["page.send_key --key=End --key_code=35 --ctrl --target=#waffle-rich-text-editor", "page.send_key --key=ArrowLeft --key_code=37 --ctrl --target=#waffle-rich-text-editor"], label = "bottom of column A" } }`,
        "",
      ].join("\n"),
    );
    await load_config_dir(dir);
  });

  const add_editor = (id) =>
    in_active_tab(`(() => {
      const editor = document.createElement("div");
      editor.id = "waffle-rich-text-editor";
      editor.tabIndex = 0;
      document.documentElement.dataset.p25Keys = "";
      editor.addEventListener("keydown", (event) => { document.documentElement.dataset.p25Keys += event.keyCode + (event.ctrlKey ? "c" : "") + ","; });
      document.body.append(editor);
      return ${JSON.stringify(id)};
    })()`);
  const keys_seen = () => in_active_tab("document.documentElement.dataset.p25Keys");
  const expect_keys = async (wanted) => {
    await poll_until(`keydown codes ${wanted}`, async () => (await keys_seen()) === wanted);
    // A bound key must not also scroll or repeat, so the record stays as it is.
    await sleep(200);
    expect((await keys_seen()) === wanted, `the codes changed to ${await keys_seen()}`);
  };

  await run_case("h, j, k and l send one arrow keydown each to the named element", async () => {
    await open_page("controls", "sheets_a", { new_tab: true });
    await add_editor("sheets_a");
    for (const [key, code] of [["h", 37], ["j", 40], ["k", 38], ["l", 39]]) {
      const before = await keys_seen();
      await press_keys(key);
      await expect_keys(`${before}${code},`);
    }
    expect((await in_active_tab("scrollY")) === 0, "a bound key also scrolled the page");
  });

  await run_case("a bind with ctrl on reaches the element as a keydown with ctrlKey set", async () => {
    await open_page("controls", "sheets_ctrl", { new_tab: true });
    await add_editor("sheets_ctrl");
    await press_keys("gg");
    await expect_keys("36c,");
  });

  await run_case("a chain bind runs both steps in order, each with ctrl set", async () => {
    await open_page("controls", "sheets_chain", { new_tab: true });
    await add_editor("sheets_chain");
    await press_keys("G");
    await expect_keys("35c,37c,");
  });

  await run_case("a count sends the key that many times", async () => {
    await open_page("controls", "sheets_count", { new_tab: true });
    await add_editor("sheets_count");
    await press_keys("3j");
    await expect_keys("40,40,40,");
  });

  await run_case("a user row binds key by key: its own j wins and the other row's keys stay", async () => {
    await open_page("controls", "sheets_over", { new_tab: true });
    await add_editor("sheets_over");
    await press_keys("j");
    await expect_keys("34,");
    await press_keys("h");
    await expect_keys("34,37,");
  });

  await run_case("a page with no row keeps the plain keys", async () => {
    await open_page("controls", "plain_sheet", { new_tab: true });
    await add_editor("plain_sheet");
    await press_keys("j");
    await poll_until("the page scrolled", async () => (await in_active_tab("scrollY")) > 0);
    expect((await keys_seen()) === "", `a key reached the editor: ${await keys_seen()}`);
  });

  await run_case("a missing target refuses and leaves the page alone", async () => {
    await open_page("controls", "sheets_missing", { new_tab: true });
    await press_keys("j");
    await sleep(300);
    expect((await in_active_tab("scrollY")) === 0, "the page scrolled although j is bound");
  });
}
