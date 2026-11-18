// The item finder (`item_navigator = true`): on a page with no site row, j and k walk the list the finder reads from the page, with the box and the focus on the title link, and Enter opens it. gg and G go to the first and last card where it is in view after the scroll, and only scroll otherwise. On a page with no list the keys scroll as they do without the setting. A shipped row for the site still decides first. The bundle-refused fallback is covered in test/content/item_finder_fallback.test.ts, because no real page makes the item bundle fail without a test hook.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "config", "bundles"];

const CARDS = 10;

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  await setup("load a config with item_navigator on", async () => {
    const dir = config_copy();
    const file = join(dir, "settings.toml");
    // A top-level setting goes above the first table.
    writeFileSync(file, `item_navigator = true\n${readFileSync(file, "utf8")}`);
    await load_config_dir(dir);
  });

  // Ten cards, each with a title link in a heading, stacked on a page that has no row and no `main`.
  const add_cards = (count = CARDS) =>
    in_active_tab(`(() => {
      const list = document.createElement("div");
      list.innerHTML = ${JSON.stringify(Array.from({ length: count }, (_, index) => `<div class="card" style="height:100px;margin:0 0 20px 20px;width:500px"><h3 style="margin:0"><a id="f${index}" href="#f${index}">Finder result number ${index} title</a></h3><span>snippet ${index}</span></div>`).join(""))};
      document.body.prepend(list);
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);
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
  const card_rect = (id) => in_active_tab(`(() => { const r = document.getElementById(${JSON.stringify(id)}).closest(".card").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  const near = (a, b) => ["left", "top", "width", "height"].every((key) => Math.abs(a[key] - b[key]) < 1.5);

  await run_case("j focuses the title link of a card, j goes on to the next and k goes back", async () => {
    await open_page("page", "finder_walk", { new_tab: true });
    await add_cards();
    await press_keys("j");
    await expect_focus("f0");
    await press_keys("j");
    await expect_focus("f1");
    await press_keys("k");
    await expect_focus("f0");
  });

  await run_case("the box sits on the card and moves with it", async () => {
    await open_page("page", "finder_box", { new_tab: true });
    await add_cards();
    await press_keys("j");
    await expect_focus("f0");
    const box_on = (index) => poll_until(`the box on card ${index}`, async () => { const drawn = await in_active_tab(READ_BOX); return drawn !== null && near(drawn, await card_rect(`f${index}`)); });
    await box_on(0);
    await press_keys("j");
    await box_on(1);
  });

  await run_case("Enter opens the focused link", async () => {
    await open_page("page", "finder_enter", { new_tab: true });
    await add_cards();
    await press_keys("j");
    await expect_focus("f0");
    await press_keys("-k", "Return");
    await poll_until("the address to name the focused card", async () => (await in_active_tab("location.hash")) === "#f0");
  });

  await run_case("a page with no list scrolls on j and moves no focus", async () => {
    await open_page("page", "finder_none", { new_tab: true });
    await press_keys("j");
    await poll_until("the page to scroll", async () => (await in_active_tab("scrollY")) > 0);
    expect((await focused()) === "", "j moved the focus on a page with no list");
    expect((await in_active_tab(READ_BOX)) === null, "a box showed on a page with no list");
  });

  await run_case("a page whose list grows after a none answer is read again, and the list is walked", async () => {
    await open_page("page", "finder_late", { new_tab: true });
    await press_keys("j");
    await poll_until("the page to scroll", async () => (await in_active_tab("scrollY")) > 0);
    // The none answer stands for half a second, so the list comes after that.
    await sleep(1000);
    await add_cards();
    await press_keys("j");
    await expect_focus("f0");
  });

  // Two lists of ten cards a screen apart, with different classes so they stay two lists: `a0` to `a9` at the top and `b0` to `b9` below a spacer.
  const add_two_lists = () =>
    in_active_tab(`(() => {
      const list = (name, parent_class) => {
        const holder = document.createElement("div");
        holder.className = parent_class;
        holder.innerHTML = Array.from({ length: 10 }, (_, index) => '<div class="card_' + name + '" style="height:100px;margin:0 0 20px 20px;width:500px"><h3 style="margin:0"><a id="' + name + index + '" href="#' + name + index + '">List ' + name + ' result number ' + index + ' title</a></h3><span>snippet</span></div>').join("");
        return holder;
      };
      const spacer = document.createElement("div");
      spacer.style.height = "2500px";
      document.body.prepend(list("a", "first"), spacer, list("b", "second"));
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);

  await run_case("j walks the list in view and hands over to the list that shows once the first one has scrolled away", async () => {
    await open_page("page", "finder_two_lists", { new_tab: true });
    await add_two_lists();
    await press_keys("j");
    await expect_focus("a0");
    await press_keys("j");
    await expect_focus("a1");
    // The user scrolls to the other list. The press after the scroll takes that list, and scrolling alone moves nothing.
    await in_active_tab("(() => { window.scrollTo(0, document.getElementById('b0').closest('div').getBoundingClientRect().top + scrollY - 20); return true; })()");
    await sleep(300);
    expect((await focused()) === "a1", "a scroll moved the focus");
    await press_keys("j");
    await expect_focus("b0");
    await press_keys("j");
    await expect_focus("b1");
  });

  // Two lists side by side, both in view: `a0` to `a11` (the larger, so the finder's first answer) on the left and `b0` to `b9` on the right.
  const add_side_lists = () =>
    in_active_tab(`(() => {
      const list = (name, count, left) => {
        const holder = document.createElement("div");
        holder.className = "side_" + name;
        holder.style.cssText = "position:absolute;top:0;left:" + left + "px;width:400px";
        holder.innerHTML = Array.from({ length: count }, (_, index) => '<div class="card_' + name + '" style="height:60px;margin:0 0 10px 0;width:400px"><h3 style="margin:0"><a id="' + name + index + '" href="#' + name + index + '">List ' + name + ' result number ' + index + ' title</a></h3><span>snippet</span></div>').join("");
        return holder;
      };
      document.body.prepend(list("a", 12, 0), list("b", 10, 450));
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);
  // The hint labels with the left edge of each, so the test picks the label on the right-hand list.
  const labels_by_left = () => in_active_tab(`[...document.documentElement.children].flatMap((child) => [...(child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint") ?? [])].map((node) => ({ text: node.textContent, left: node.getBoundingClientRect().left }))).sort((a, b) => a.left - b.left)`);

  await run_case(";j labels each list, and the list picked keeps j and k while the first list still shows", async () => {
    await open_page("page", "finder_pick_list", { new_tab: true });
    await add_side_lists();
    await press_keys("j");
    await expect_focus("a0");
    await press_keys(";j");
    await poll_until("a label on each list", async () => (await labels_by_left())?.length === 2);
    const [, right] = await labels_by_left();
    await press_keys(right.text);
    // The pick focuses the title link, as j does, so Enter opens it.
    await expect_focus("b0");
    await press_keys("j");
    await expect_focus("b1");
    await press_keys("j");
    await expect_focus("b2");
    await press_keys("k");
    await expect_focus("b1");
  });

  await run_case(";j labels a list in a scroll box whose top items are scrolled out of the box", async () => {
    await open_page("page", "finder_pick_scrolled_list", { new_tab: true });
    await add_side_lists();
    // The right-hand list sits in a box of its own, scrolled past its first four cards, with the clipped ones still inside the window above it, as a playlist panel scrolls to the video that plays.
    await in_active_tab(`(() => {
      const holder = document.querySelector(".side_b");
      holder.style.cssText += ";top:250px;height:420px;overflow-y:auto";
      holder.scrollTop = 280;
      return true;
    })()`);
    await press_keys("j");
    await expect_focus("a0");
    await press_keys(";j");
    await poll_until("a label on each list", async () => (await labels_by_left())?.length === 2);
    const [, right] = await labels_by_left();
    await press_keys(right.text);
    const picked = await in_active_tab("document.activeElement?.id ?? ''");
    expect(/^b[4-9]$/.test(picked), "the pick focused " + picked + ", not a shown item of the scrolled list");
    await press_keys("j");
    await poll_until("focus on a later item of the second list", async () => /^b\d$/.test(await focused()) && (await focused()) !== picked);
  });

  const at_bottom = () => in_active_tab("scrollY + innerHeight >= document.documentElement.scrollHeight - 2");
  // Hides the rest of the page, so the cards are all of it and the first and last card are in view at the page ends.
  const only_cards = () => in_active_tab(`(() => { const list = document.querySelector(".card").parentElement; for (const child of document.body.children) if (child !== list) child.style.display = "none"; window.scrollTo(0, 0); return true; })()`);

  await run_case("G goes to the last card and gg to the first, when the card is in view after the scroll", async () => {
    await open_page("page", "finder_ends", { new_tab: true });
    await add_cards(30);
    await only_cards();
    await press_keys("G");
    await expect_focus("f29");
    expect(await at_bottom(), "G did not scroll to the bottom");
    await press_keys("gg");
    await expect_focus("f0");
    await poll_until("the page top", async () => (await in_active_tab("scrollY")) === 0);
  });

  await run_case("gg with the first card below the fold only scrolls, and the next j does not jump back", async () => {
    await open_page("page", "finder_ends_far", { new_tab: true });
    await add_cards(30);
    await in_active_tab(`(() => { const spacer = document.createElement("div"); spacer.style.height = "3000px"; document.body.prepend(spacer); window.scrollTo(0, 3000); return true; })()`);
    await press_keys("gg");
    await poll_until("the page top", async () => (await in_active_tab("scrollY")) === 0);
    expect((await focused()) === "", "gg moved the focus to a card far below the view");
    expect((await in_active_tab(READ_BOX)) === null, "gg drew a box on a card far below the view");
    await press_keys("j");
    await sleep(500);
    expect((await in_active_tab("scrollY")) < 500, "j jumped back down the page after gg");
  });

  await run_case("gg and G scroll to the top and bottom of a page with no list", async () => {
    await open_page("page", "finder_ends_none", { new_tab: true });
    await press_keys("G");
    await poll_until("the page bottom", at_bottom);
    await press_keys("gg");
    await poll_until("the page top", async () => (await in_active_tab("scrollY")) === 0);
    expect((await focused()) === "", "gg moved the focus on a page with no list");
  });
}
