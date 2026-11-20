// The shipped Hacker News row on a stand-in thread (the `hn_thread` page of the test server): l and h walk to the first reply and the parent, } and { to the next and previous sibling, za, zc and zo click the page's own fold control, and on a page with no comment h and l keep their sideways scroll.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config", "bundles"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);

export async function run_cases({ run_line, config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  await setup("load the shipped Hacker News row for the hn_ pages", async () => {
    const dir = config_copy();
    const { site: _site, ...columns } = DEFAULT_SITE_ROWS.find((entry) => entry.name === "hackernews").row;
    const lines = ["", "[[site_rules]]", 'site = "*://127.0.0.1/*?id=hn_*"', ...Object.entries(columns).map(([column, value]) => `${column} = ${toml(value)}`), ""];
    appendFileSync(join(dir, "settings.toml"), lines.join("\n"));
    await load_config_dir(dir);
  });

  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);
  const clicks = () => in_active_tab("document.documentElement.dataset.clicks ?? ''");
  const toast_text = () => in_active_tab(`[...document.documentElement.children].find((child) => child.style.zIndex === "2147483645")?.openOrClosedShadowRoot?.querySelector(".desertfox-toast")?.textContent ?? ""`);
  const expect_toast = (text) => poll_until(`the notice ${text}`, async () => (await toast_text()).includes(text));
  // The thread: k0 holds k1 (which holds k2) and k3, k4 holds k5, k6 stands alone.
  const open_thread = async (id, start = "k0") => {
    await open_page("hn_thread", `hn_${id}`, { new_tab: true });
    await run_line("mode item");
    await poll_until("item mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "ITEM");
    // The first j lands on the story, the second on the first comment.
    await press_keys("jj");
    await expect_focus(start);
  };

  await run_case("l goes to the first reply, h to the parent, } and { to the siblings, and a count repeats the move", async () => {
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
    // The move lands like j: the next j continues from there.
    await press_keys("k");
    await expect_focus("k5");
  });

  await run_case("the ends of the tree say so", async () => {
    await open_thread("ends");
    await press_keys("h");
    await expect_toast("No parent");
    await press_keys("{");
    await expect_toast("No previous sibling");
    await press_keys("l");
    await press_keys("l");
    await expect_focus("k2");
    await press_keys("l");
    await expect_toast("No child");
    await press_keys("}");
    await expect_toast("No next sibling");
    expect((await focused()) === "k2", `the focus moved to ${await focused()}`);
  });

  await run_case("za clicks the fold control and j skips the folded replies, zo opens them again", async () => {
    await open_thread("fold");
    await press_keys("za");
    await poll_until("the fold click", async () => (await clicks()) === "k0,");
    await press_keys("j");
    await expect_focus("k4");
    await press_keys("k");
    await expect_focus("k0");
    await press_keys("zo");
    await poll_until("the unfold click", async () => (await clicks()) === "k0,k0,");
    await press_keys("j");
    await expect_focus("k1");
    // Nothing to unfold: no click.
    await press_keys("zo");
    await sleep(200);
    expect((await clicks()) === "k0,k0,", `zo clicked ${await clicks()}`);
  });

  await run_case("l on a folded comment unfolds it and stays on it", async () => {
    await open_thread("unfold");
    await press_keys("za");
    await poll_until("the fold click", async () => (await clicks()) === "k0,");
    await press_keys("l");
    await poll_until("the unfold click", async () => (await clicks()) === "k0,k0,");
    expect((await focused()) === "k0", `the focus moved to ${await focused()}`);
  });

  await run_case("zc on a leaf folds its parent and lands on it, zc on a comment with replies folds that comment", async () => {
    await open_thread("close");
    await press_keys("ll");
    await expect_focus("k2");
    await press_keys("zc");
    await poll_until("the parent folded", async () => (await clicks()) === "k1,");
    await expect_focus("k1");
    await press_keys("j");
    await expect_focus("k3");
    await press_keys("k");
    await expect_focus("k1");
    // k1 is folded now, so zc folds its parent k0.
    await press_keys("zc");
    await poll_until("the thread folded", async () => (await clicks()) === "k1,k0,");
    await expect_focus("k0");
    await press_keys("zc");
    await expect_toast("Nothing to fold");
  });

  await run_case("opening a folded thread keeps the replies of a still folded comment hidden", async () => {
    await open_thread("nested");
    await press_keys("ll");
    await expect_focus("k2");
    await press_keys("zc");
    await poll_until("k1 folded", async () => (await clicks()) === "k1,");
    await press_keys("h");
    await expect_focus("k0");
    await press_keys("za");
    await poll_until("k0 folded", async () => (await clicks()) === "k1,k0,");
    await press_keys("zo");
    await poll_until("k0 opened", async () => (await clicks()) === "k1,k0,k0,");
    const hidden = (id) => in_active_tab(`document.getElementById("${id}").classList.contains("noshow")`);
    expect(!(await hidden("k1")) && !(await hidden("k3")) && (await hidden("k2")), "k1 and k3 show and k2 stays hidden");
    await press_keys("j");
    await expect_focus("k1");
    await press_keys("j");
    await expect_focus("k3");
  });

  // The first tree key loads the bundle, and the j typed behind it waits for the run to land.
  await run_case("a j typed right behind the first tree key runs after it", async () => {
    await open_thread("order");
    await press_keys("}j");
    await expect_focus("k5");
  });

  await run_case("on a page with no comment, h and l keep the sideways scroll", async () => {
    await open_page("hn_front", "hn_front", { new_tab: true });
    await run_line("mode item");
    await poll_until("item mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "ITEM");
    await press_keys("l");
    await poll_until("the scroll right", async () => (await in_active_tab("window.scrollX")) > 0);
    await press_keys("h");
    await poll_until("the scroll back", async () => (await in_active_tab("window.scrollX")) === 0);
  });
}
