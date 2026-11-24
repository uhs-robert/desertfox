// The default item keys on a stand-in role=tree (the `aria_tree` page of the test server): l and h walk to the first child and the parent through a role=none wrapper, } and { to the siblings, za, zc and zo fold by ArrowLeft and ArrowRight with the key code the page reads, l on a folded item only opens it, and a tree that moves its focus by aria-activedescendant is refused.

export const areas = ["keys", "config", "bundles"];

export async function run_cases({ run_line, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  const focused = () => in_active_tab("document.activeElement?.closest('[role=treeitem]')?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);
  const keys = () => in_active_tab("document.documentElement.dataset.keys ?? ''");
  const expect_keys = (wanted) => poll_until(`the keys ${wanted}`, async () => (await keys()) === wanted);
  const expanded = (id) => in_active_tab(`document.getElementById("${id}").getAttribute("aria-expanded")`);
  const toast_text = () => in_active_tab(`[...document.documentElement.children].find((child) => child.style.zIndex === "2147483645")?.openOrClosedShadowRoot?.querySelector(".desertfox-toast")?.textContent ?? ""`);
  const expect_toast = (text) => poll_until(`the notice ${text}`, async () => (await toast_text()).includes(text));
  // I picks the tree, the one list on the page, and lands on its first item.
  const open_tree = async (id, lands = true) => {
    await open_page("aria_tree", `aria_${id}`, { new_tab: true });
    await run_line("mode item");
    await poll_until("item mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "ITEM");
    await press_keys("I");
    if (lands) await expect_focus("t0");
  };

  await run_case("l goes to the first child and h to the parent through a role=none wrapper, } and { to the siblings", async () => {
    await open_tree("walk");
    await press_keys("l");
    await expect_focus("t1");
    await press_keys("l");
    await expect_focus("t2");
    await press_keys("h");
    await expect_focus("t1");
    await press_keys("}");
    await expect_focus("t3");
    await press_keys("{");
    await expect_focus("t1");
    await press_keys("hh");
    await expect_toast("No parent");
    await expect_focus("t0");
    await press_keys("2}");
    await expect_focus("t6");
    expect((await keys()) === "", `a move sent the keys ${await keys()}`);
  });

  await run_case("za folds and unfolds by the arrows with the key code the page reads", async () => {
    await open_tree("fold");
    await press_keys("za");
    await expect_keys("37:t0,");
    await poll_until("t0 folded", async () => (await expanded("t0")) === "false");
    await press_keys("j");
    await expect_focus("t4");
    await press_keys("k");
    await expect_focus("t0");
    await press_keys("zo");
    await expect_keys("37:t0,39:t0,");
    await poll_until("t0 open", async () => (await expanded("t0")) === "true");
    await press_keys("zo");
    await sleep(200);
    expect((await keys()) === "37:t0,39:t0,", `zo on an open item sent ${await keys()}`);
  });

  await run_case("l on a folded item only opens it, and zc on a leaf folds its parent", async () => {
    await open_tree("open");
    await press_keys("}");
    await expect_focus("t4");
    await press_keys("l");
    await expect_keys("39:t4,");
    await poll_until("t4 open", async () => (await expanded("t4")) === "true");
    await expect_focus("t4");
    await press_keys("l");
    await expect_focus("t5");
    await press_keys("zc");
    await expect_keys("39:t4,37:t4,");
    await poll_until("t4 folded", async () => (await expanded("t4")) === "false");
    await expect_focus("t4");
  });

  await run_case("j reads a tree again when a folder that hides its closed rows opens", async () => {
    await open_tree("hidden_rows");
    await press_keys("}");
    await expect_focus("t4");
    await press_keys("l");
    await poll_until("t4 open", async () => (await expanded("t4")) === "true");
    await press_keys("j");
    await expect_focus("t5");
  });

  await run_case("a tree with no aria-level takes its depth from the nesting", async () => {
    await open_tree("nolevel");
    await press_keys("l");
    await expect_focus("t1");
    await press_keys("l");
    await expect_focus("t2");
    await press_keys("}");
    await expect_toast("No next sibling");
    await press_keys("h");
    await expect_focus("t1");
  });

  await run_case("za on a leaf folds nothing and sends no key", async () => {
    await open_tree("leaf");
    await press_keys("}");
    await expect_focus("t4");
    await press_keys("ll");
    await expect_focus("t5");
    await press_keys("za");
    await expect_toast("Nothing to fold");
    expect((await keys()) === "39:t4,", `za on a leaf sent ${await keys()}`);
  });

  await run_case("zc on a branch that just opened, before its children show, folds that branch", async () => {
    await open_tree("lazy");
    await press_keys("}");
    await expect_focus("t4");
    await press_keys("l");
    await expect_keys("39:t4,");
    await press_keys("zc");
    await expect_keys("39:t4,37:t4,");
    await poll_until("t4 folded", async () => (await expanded("t4")) === "false");
    await expect_focus("t4");
  });

  // With the focus on the page and not in the tree, } and { keep the section jump of item mode.
  await run_case("with the focus outside the tree, } runs the plain section jump", async () => {
    await open_tree("body");
    await in_active_tab("document.activeElement?.blur()");
    await press_keys("}");
    await expect_toast("No sections in this list");
  });

  // The focus is on the tree itself, which tabindex and aria-activedescendant make focusable, so the tree step runs and refuses.
  await run_case("a tree that moves its focus by aria-activedescendant is refused with a notice", async () => {
    await open_tree("ad_refused", false);
    await in_active_tab(`document.querySelector("[role=tree]").focus()`);
    await press_keys("l");
    await expect_toast("aria-activedescendant");
    await sleep(200);
    expect((await keys()) === "", `the refused key sent ${await keys()}`);
  });
}
