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
    for (const [pattern, name] of [["*://127.0.0.1/reddit_thread*", "reddit_thread"], ["*://127.0.0.1/controls?id=reddit_feed*", "reddit"]]) {
      const { site: _site, ...columns } = DEFAULT_SITE_ROWS.find((entry) => entry.name === name).row;
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

  await run_case("zc on a leaf folds its parent, and zo opens a folded comment", async () => {
    await open_thread("close");
    await press_keys("ll");
    await expect_focus("k2");
    await press_keys("zc");
    await poll_until("the parent folded", async () => (await clicks()) === "k1,");
    await expect_focus("k1");
    await press_keys("h}");
    await expect_focus("k4");
    await press_keys("zo");
    await poll_until("the unfold click", async () => (await clicks()) === "k1,k4,");
  });

  const READ_BOX = `(() => {
    for (const child of document.documentElement.children) {
      const box = child.openOrClosedShadowRoot?.querySelector(".desertfox-item-box");
      if (!box) continue;
      const rect = box.getBoundingClientRect();
      return child.isConnected && box.style.visibility !== "hidden" ? { top: rect.top + scrollY, height: rect.height } : null;
    }
    return null;
  })()`;
  const page_rect = (id) => in_active_tab(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY }; })()`);

  await run_case("j reads a comment taller than the window to its end, the box covers the head and the text, and a reply's text stays out", async () => {
    await open_page("reddit_thread", "reddit_long_read", { new_tab: true });
    await enter_item_mode();
    await press_keys("j");
    await expect_focus("k0");
    const head = await page_rect("k0");
    const text = await page_rect("t0");
    const reply_text = await page_rect("t2");
    await poll_until("the box on k0", async () => !!(await in_active_tab(READ_BOX)));
    const box = await in_active_tab(READ_BOX);
    expect(Math.abs(box.top - head.top) < 2 && Math.abs(box.top + box.height - text.bottom) < 2, `the box ${JSON.stringify(box)} does not run from the head ${head.top} to the text bottom ${text.bottom}`);
    expect(box.top + box.height < reply_text.bottom - 1, "the box covers the reply's text");
    // The comment runs past the window, so j scrolls on it until its text ends, and only then goes to the reply.
    await press_keys("j");
    await sleep(300);
    expect((await focused()) === "k0", "the first j left the long comment");
    expect((await in_active_tab("scrollY")) > 0, "the first j did not scroll");
    for (let press = 0; press < 80 && (await focused()) === "k0"; press++) {
      await press_keys("j");
      await sleep(60);
    }
    await expect_focus("k1");
    expect((await in_active_tab("scrollY")) + (await in_active_tab("innerHeight")) >= text.bottom - 2, "j left k0 before its text came into view");
  });

  const open_long = async (id) => {
    await open_page("reddit_thread", `reddit_long_${id}`, { new_tab: true });
    await enter_item_mode();
  };
  const box_bottom = async () => {
    await poll_until("the box", async () => !!(await in_active_tab(READ_BOX)));
    const box = await in_active_tab(READ_BOX);
    return box.top + box.height;
  };

  await run_case("a comment with no text of its own keeps its author line as the box, though its reply has text", async () => {
    await open_long("own_text");
    await press_keys("j");
    await expect_focus("k0");
    await press_keys("l");
    await expect_focus("k1");
    const head = await page_rect("k1");
    expect(Math.abs((await box_bottom()) - head.bottom) < 2, "the box of k1 covers more than its author line");
  });

  await run_case("gg on the thread lands with the extended box", async () => {
    await open_long("ends");
    await press_keys("gg");
    await expect_focus("k0");
    expect(Math.abs((await box_bottom()) - (await page_rect("t0")).bottom) < 2, "gg boxed the head only");
  });

  await run_case("I on the thread lands with the extended box", async () => {
    await open_page("reddit_thread", "reddit_long_pick", { new_tab: true });
    await press_keys("I");
    await poll_until("item mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "ITEM");
    await expect_focus("k0");
    expect(Math.abs((await box_bottom()) - (await page_rect("t0")).bottom) < 2, "I boxed the head only");
  });

  await run_case("v on a long comment keeps its extended box", async () => {
    await open_long("visual");
    await press_keys("j");
    await expect_focus("k0");
    await press_keys("v");
    await poll_until("visual item mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "VISUAL 1");
    expect(Math.abs((await box_bottom()) - (await page_rect("t0")).bottom) < 2, "v shrank the box to the head");
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
