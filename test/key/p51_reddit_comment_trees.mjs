// The shipped Reddit thread rows on a stand-in thread (the `reddit_thread` page of the test server): l and h walk to the first reply and the parent, } and { to the next and previous sibling, za clicks the head and j skips the replies it folded, a folded reply is skipped from the start, and on a feed page h keeps its sideways scroll.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config", "bundles"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);

export async function run_cases({ run_line, config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  // The thread row comes before the feed row, as in the shipped table, so the first row that matches a page decides each key.
  await setup("load the shipped Reddit thread row and feed row for the stand-in pages", async () => {
    const dir = config_copy();
    const lines = [""];
    for (const [pattern, matches] of [["*://127.0.0.1/reddit_thread*", (row) => row.site.includes("/comments/")], ["*://127.0.0.1/controls?id=reddit_feed*", (row) => !row.site.includes("/comments/")]]) {
      const { site: _site, ...columns } = DEFAULT_SITE_ROWS.find((entry) => entry.name === "reddit" && matches(entry.row)).row;
      lines.push("[[site_rules]]", `site = "${pattern}"`, ...Object.entries(columns).map(([column, value]) => `${column} = ${toml(value)}`), "");
    }
    appendFileSync(join(dir, "settings.toml"), lines.join("\n"));
    await load_config_dir(dir);
  });

  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);
  const clicks = () => in_active_tab("document.documentElement.dataset.clicks ?? ''");
  const enter_item_mode = async () => {
    await run_line("mode item");
    await poll_until("item mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "ITEM");
  };
  // The thread: k0 holds k1 (which holds k2) and k3, k4 holds k5 and starts folded, k6 stands alone. The first j lands on k0.
  const open_thread = async (id, start = "k0") => {
    await open_page("reddit_thread", `reddit_${id}`, { new_tab: true });
    await enter_item_mode();
    await press_keys("j");
    await expect_focus(start);
  };

  await run_case("l goes to the first reply, h to the parent, } and { to the siblings", async () => {
    await open_thread("walk");
    await press_keys("l");
    await expect_focus("k1");
    await press_keys("l");
    await expect_focus("k2");
    await press_keys("h");
    await expect_focus("k1");
    await press_keys("}");
    await expect_focus("k3");
    await press_keys("{");
    await expect_focus("k1");
    await press_keys("h");
    await expect_focus("k0");
    await press_keys("2}");
    await expect_focus("k6");
    await press_keys("k");
    await expect_focus("k4");
  });

  await run_case("a folded reply is skipped by j, and l on it unfolds it and stays", async () => {
    await open_thread("folded_start");
    await press_keys("}");
    await expect_focus("k4");
    await press_keys("j");
    await expect_focus("k6");
    await press_keys("k");
    await expect_focus("k4");
    await press_keys("l");
    await poll_until("the unfold click", async () => (await clicks()) === "k4,");
    expect((await focused()) === "k4", `the focus moved to ${await focused()}`);
    await press_keys("j");
    await expect_focus("k5");
  });

  await run_case("za folds the comment and j skips its replies", async () => {
    await open_thread("fold");
    await press_keys("za");
    await poll_until("the fold click", async () => (await clicks()) === "k0,");
    await press_keys("j");
    await expect_focus("k4");
    await press_keys("k");
    await expect_focus("k0");
    await press_keys("za");
    await poll_until("the unfold click", async () => (await clicks()) === "k0,k0,");
    await press_keys("j");
    await expect_focus("k1");
  });

  await run_case("the thread page does not start item mode, and I offers the comment heads", async () => {
    await open_page("reddit_thread", "reddit_start", { new_tab: true });
    await sleep(1500);
    expect((await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? ""`)) !== "ITEM", "item mode started on its own");
    await press_keys("I");
    await poll_until("item mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "ITEM");
    await expect_focus("k0");
    await press_keys("l");
    await expect_focus("k1");
  });

  await run_case("on a feed page, h keeps the sideways scroll", async () => {
    await open_page("controls", "reddit_feed", { new_tab: true });
    await enter_item_mode();
    await in_active_tab(`(() => { const wide = document.createElement("div"); wide.style.cssText = "width:3000px;height:1px"; document.body.prepend(wide); document.activeElement?.blur(); return true; })()`);
    await press_keys("l");
    await poll_until("the scroll right", async () => (await in_active_tab("window.scrollX")) > 0);
    await press_keys("h");
    await poll_until("the scroll back", async () => (await in_active_tab("window.scrollX")) === 0);
  });
}
