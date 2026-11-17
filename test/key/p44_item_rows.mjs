// The shipped result-page rows (google here) on a test address with the site pattern swapped: j and k focus the result links one by one, Enter opens one, a count walks several, and the box DesertFox draws follows the item and clears on blur, Escape, a mode change and the item leaving the page.
// The box sits in a closed shadow root. The extension's own world reads it with openOrClosedShadowRoot.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config", "bundles"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);
const ITEMS = 12;

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  await setup("load the shipped google row for the item_ pages the hackernews row for the hn_ pages and the ddg row for the ddg_ pages and the ddg_images row for the img_ pages", async () => {
    const dir = config_copy();
    const lines = [];
    for (const [name, id] of [["google", "item"], ["hackernews", "hn"], ["ddg", "ddg"], ["ddg_images", "img"]]) {
      const shipped = DEFAULT_SITE_ROWS.find((entry) => entry.name === name)?.row;
      if (!shipped) throw new Error(`no shipped site row named ${name}`);
      const { site: _site, ...columns } = shipped;
      lines.push("", "[[site_rules]]", `site = "*://127.0.0.1/*?id=${id}_*"`, ...Object.entries(columns).map(([column, value]) => `${column} = ${toml(value)}`));
    }
    appendFileSync(join(dir, "settings.toml"), [...lines, ""].join("\n"));
    await load_config_dir(dir);
  });

  // The stand-in results: a block per result with a title link (an h3 inside the anchor) and an address and snippet beside it, as Google's result blocks have. A People also ask question sits among them, with an h3 link but outside any result block, and the row must skip it.
  const open_results = async (id, first_height = 60) => {
    await open_page("controls", `item_${id}`, { new_tab: true });
    await in_active_tab(`(() => {
      const search = document.createElement("div");
      search.id = "search";
      search.innerHTML = ${JSON.stringify(Array.from({ length: ITEMS }, (_, index) => `<div class="MjjYud" style="height:${index === 0 ? first_height : 60}px;margin:0 0 40px 20px;width:300px"><a id="r${index}" href="#r${index}" style="display:block"><h3>result ${index}</h3></a><span>example.org snippet ${index}</span></div>` + (index === 1 ? '<div class="related-question-pair"><a id="paa" href="#paa"><h3>a question</h3></a></div>' : "")).join(""))};
      document.body.prepend(search);
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);
  };
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);
  const READ_BOX = `(() => {
    for (const child of document.documentElement.children) {
      const box = child.openOrClosedShadowRoot?.querySelector(".desertfox-item-box");
      if (!box) continue;
      const rect = box.getBoundingClientRect();
      return child.isConnected && box.style.visibility !== "hidden" ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
    }
    return null;
  })()`;
  const box = () => in_active_tab(READ_BOX);
  const link_rect = () => in_active_tab(`(() => { const r = (document.activeElement.closest(".MjjYud") ?? document.activeElement).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  const near = (a, b) => ["left", "top", "width", "height"].every((key) => Math.abs(a[key] - b[key]) < 1.5);
  const expect_box_on_focus = (what) => poll_until(what, async () => { const drawn = await box(); return drawn !== null && near(drawn, await link_rect()); });
  const expect_box_on = (id, what) => poll_until(what, async () => { const drawn = await box(); return drawn !== null && near(drawn, await in_active_tab(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`)); });
  const expect_no_box = (what) => poll_until(what, async () => (await box()) === null);

  await run_case("j focuses the first result in view and k goes back, one result each, and the page does not scroll by line", async () => {
    await open_results("walk");
    await press_keys("j");
    await expect_focus("r0");
    await press_keys("jj");
    await expect_focus("r2");
    await press_keys("k");
    await expect_focus("r1");
    expect((await in_active_tab("scrollY")) === 0, "j or k scrolled by line instead of moving to the result");
  });

  await run_case("the box sits on the focused result and moves with it", async () => {
    await open_results("box");
    await press_keys("j");
    await expect_box_on_focus("the box on the first result");
    await press_keys("j");
    await expect_box_on_focus("the box on the second result");
  });

  await run_case("Enter opens the focused result", async () => {
    await open_results("enter");
    await press_keys("jj");
    await expect_focus("r1");
    await press_keys("-k", "Return");
    await poll_until("the address to name the second result", async () => (await in_active_tab("location.hash")) === "#r1");
  });

  await run_case("a count walks that many results, and a count past the end stops on the last one", async () => {
    await open_results("count");
    await press_keys("3j");
    await expect_focus("r2");
    await press_keys("99j");
    await expect_focus(`r${ITEMS - 1}`);
    await press_keys("2k");
    await expect_focus(`r${ITEMS - 3}`);
  });

  await run_case("past the last result j keeps the focus there", async () => {
    await open_results("end");
    await press_keys("99j");
    await expect_focus(`r${ITEMS - 1}`);
    const before = await in_active_tab("scrollY");
    await press_keys("j");
    await poll_until("j to scroll on past the last result", async () => (await in_active_tab("scrollY")) === before + 50);
    expect((await focused()) === `r${ITEMS - 1}`, `the focus left the last result for ${await focused()}`);
    await press_keys("2k");
    await poll_until("k to move back from the last result", async () => (await focused()) === `r${ITEMS - 3}`);
  });

  await run_case("while a result runs past the bottom of the view j scrolls, and once its end is in view j moves on", async () => {
    await open_results("tall", 3000);
    await press_keys("j");
    await expect_focus("r0");
    const before = await in_active_tab("scrollY");
    await press_keys("j");
    await poll_until("j to scroll 50 px", async () => (await in_active_tab("scrollY")) === before + 50);
    expect((await focused()) === "r0", `j left the tall result for ${await focused()}`);
    // 50 presses of 50 px bring the end of the 3000 px result into view.
    await press_keys("50j");
    await poll_until("the end of the tall result to come into view", async () => (await in_active_tab("scrollY")) >= before + 50 + 2400);
    expect((await focused()) === "r0", `the count left the tall result for ${await focused()}`);
    await press_keys("j");
    await expect_focus("r1");
  });

  await run_case("the box follows a scroll and a resize", async () => {
    await open_results("follow");
    await press_keys("j");
    await expect_box_on_focus("the box on the first result");
    await in_active_tab("window.scrollBy(0, 30); 0");
    await expect_box_on_focus("the box after a scroll");
    await in_active_tab(`(() => { document.getElementById("r0").closest(".MjjYud").style.marginLeft = "120px"; window.dispatchEvent(new Event("resize")); return 0; })()`);
    await expect_box_on_focus("the box after a resize");
  });

  await run_case("the box follows a layout shift that fires no scroll or resize", async () => {
    await open_results("shift");
    await press_keys("j");
    await expect_box_on_focus("the box on the first result");
    await in_active_tab(`document.getElementById("r0").closest(".MjjYud").style.marginLeft = "150px"; 0`);
    await expect_box_on_focus("the box after the shift");
  });

  await run_case("Escape clears the box and blurs the result, and j starts again from it", async () => {
    await open_results("escape");
    await press_keys("jj");
    await expect_focus("r1");
    await press_keys("-k", "Escape");
    await expect_no_box("the box to clear on Escape");
    await press_keys("j");
    await expect_focus("r2");
    await expect_box_on_focus("the box on the third result");
  });

  await run_case("focus leaving the result clears the box", async () => {
    await open_results("blur");
    await press_keys("j");
    await expect_box_on_focus("the box on the first result");
    await in_active_tab("document.activeElement.blur(); 0");
    await expect_no_box("the box to clear on blur");
  });

  await run_case("a mode change clears the box", async () => {
    await open_results("mode");
    await press_keys("j");
    await expect_box_on_focus("the box on the first result");
    // Hint mode takes no focus from the result, so only the timer that reads the mode can clear the box.
    await press_keys("f");
    expect((await focused()) === "r0", "hint mode moved the focus, so the timer is not what clears the box");
    await expect_no_box("the box to clear in hint mode");
    await press_keys("-k", "Escape");
  });

  await run_case("a result that leaves the page takes the box with it", async () => {
    await open_results("removed");
    await press_keys("j");
    await expect_box_on_focus("the box on the first result");
    await in_active_tab(`document.getElementById("r0").closest(".MjjYud").remove(); 0`);
    await expect_no_box("the box to clear when its result is gone");
  });

  await run_case("on a matched page with no result, j and k scroll by line and show no box", async () => {
    await open_page("controls", "item_empty", { new_tab: true });
    await press_keys("j");
    await poll_until("j scrolled the page", async () => (await in_active_tab("scrollY")) > 0);
    expect((await box()) === null, "a box showed on a page with no result");
    await press_keys("kk");
    await poll_until("k scrolled back to the top", async () => (await in_active_tab("scrollY")) === 0);
  });

  // A Hacker News shaped list: a story row with a title link, then a comment-like row with no title link, only a user link.
  await run_case("a row with a link selector focuses that link, and an item without one takes focus itself", async () => {
    await open_page("controls", "hn_list", { new_tab: true });
    await in_active_tab(`(() => {
      const table = document.createElement("table");
      table.innerHTML = '<tr class="athing" id="story"><td><span class="titleline"><a id="title" href="#title">a story</a></span></td></tr><tr class="athing" id="comment"><td style="height:60px"><a id="user" href="#user">someone</a> a comment</td></tr>';
      document.body.prepend(table);
      document.activeElement?.blur();
      return true;
    })()`);
    await press_keys("j");
    await expect_focus("title");
    await expect_box_on("story", "the box on the story row, not on its link");
    await press_keys("j");
    await expect_focus("comment");
    expect((await in_active_tab(`document.getElementById("comment").getAttribute("tabindex")`)) === "-1", "the comment row has no tabindex -1");
    await expect_box_on("comment", "the box on the comment row");
  });

  // A DuckDuckGo shaped list: result articles with a title link, and an ad article with the same link that must be skipped.
  await run_case("on ddg, j walks the result articles and skips the ad, and past the last result it scrolls on", async () => {
    await open_page("controls", "ddg_list", { new_tab: true });
    await in_active_tab(`(() => {
      const list = document.createElement("ol");
      list.innerHTML = '<li><article data-testid="ad"><a data-testid="result-title-a" id="ad" href="#ad">ad</a></article></li>' + [0, 1, 2].map((index) => '<li><article data-testid="result" style="height:60px;margin-bottom:40px"><a data-testid="result-title-a" id="d' + index + '" href="#d' + index + '">result ' + index + '</a><p>snippet</p></article></li>').join("");
      document.body.prepend(list);
      document.activeElement?.blur();
      return true;
    })()`);
    await press_keys("jj");
    await expect_focus("d1");
    await in_active_tab(`document.getElementById("d1").closest("article").id = "a1"; 0`);
    await expect_box_on("a1", "the box on the whole result article");
    await press_keys("j");
    await expect_focus("d2");
    const before = await in_active_tab("scrollY");
    await press_keys("j");
    await poll_until("j to scroll on from the last result", async () => (await in_active_tab("scrollY")) === before + 50);
  });

  // A DuckDuckGo images shaped grid: rows of figures with a caption link, widths that differ from row to row, as its justified layout has.
  await run_case("on ddg images, h and l step along a row of tiles and j and k go to the tile below and above", async () => {
    await open_page("controls", "img_grid", { new_tab: true });
    await in_active_tab(`(() => {
      const widths = [[200, 120, 160], [150, 190, 140], [180, 130, 170]];
      const grid = document.createElement("ol");
      grid.style.cssText = "list-style:none;margin:0;padding:0";
      grid.innerHTML = widths.map((row, r) => '<li style="display:flex;gap:10px;margin-bottom:20px">' + row.map((width, c) => '<figure style="margin:0;width:' + width + 'px;height:80px"><a id="t' + r + c + '" href="#t' + r + c + '">tile ' + r + c + '</a></figure>').join("") + '</li>').join("");
      document.body.prepend(grid);
      document.activeElement?.blur();
      return true;
    })()`);
    await press_keys("j");
    await expect_focus("t00");
    await press_keys("l");
    await expect_focus("t01");
    await press_keys("j");
    await expect_focus("t11");
    await press_keys("h");
    await expect_focus("t10");
    await press_keys("k");
    await expect_focus("t00");
    await press_keys("2l");
    await expect_focus("t02");
    await press_keys("j");
    await expect_focus("t12");
    await press_keys("-k", "Return");
    await poll_until("the address to name the tile", async () => (await in_active_tab("location.hash")) === "#t12");
  });

  await run_case("on ddg images, h at the start of a row says there is no previous tile and does not scroll", async () => {
    await open_page("controls", "img_edge", { new_tab: true });
    await in_active_tab(`(() => {
      const grid = document.createElement("div");
      grid.innerHTML = '<figure style="width:200px;height:80px"><a id="only" href="#only">only</a></figure>';
      document.body.prepend(grid);
      document.activeElement?.blur();
      return true;
    })()`);
    await press_keys("j");
    await expect_focus("only");
    await press_keys("h");
    await sleep(300);
    expect((await focused()) === "only" && (await in_active_tab("scrollX")) === 0, "h moved the focus or scrolled");
  });

  await run_case("on a page with no result row, j scrolls and no box shows", async () => {
    await open_page("controls", "plain_item", { new_tab: true });
    await press_keys("j");
    await poll_until("j scrolled the page", async () => (await in_active_tab("scrollY")) > 0);
    expect((await box()) === null, "a box showed on a page with no result row");
  });
}
