// ARIA lists (role=grid, listbox, feed and tree) in item mode: the `I` picker offers a list the finder's title-link rule misses, j and k walk its rows, and Enter clicks the row. A grid with roving focus takes the focus on each row. A listbox that names its active row (aria-activedescendant) never loses its own focus: the box alone shows the row, and keeps working after it clears on the key.

export const areas = ["keys", "bundles"];

const ROWS = 12;

export async function run_cases({ run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const READ_BOX = `(() => {
    for (const child of document.documentElement.children) {
      const box = child.openOrClosedShadowRoot?.querySelector(".desertfox-item-box");
      if (!box) continue;
      const rect = box.getBoundingClientRect();
      return child.isConnected && box.style.visibility !== "hidden" ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
    }
    return null;
  })()`;
  const rect_of = (id) => in_active_tab(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  const near = (a, b) => ["left", "top", "width", "height"].every((key) => Math.abs(a[key] - b[key]) < 1.5);
  const box_on = (id) => poll_until(`the box on ${id}`, async () => { const drawn = await in_active_tab(READ_BOX); return drawn !== null && near(drawn, await rect_of(id)); });
  // `window.__log` takes every focus that reaches an element of the page and every click.
  const logged = () => in_active_tab("JSON.stringify(window.__log)");
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);
  const draw = (widget_attrs, row_attrs, role_of_widget, role_of_row) =>
    in_active_tab(`(() => {
      window.__log = [];
      document.addEventListener("focusin", (event) => window.__log.push("focus " + event.target.id), true);
      document.addEventListener("click", (event) => window.__log.push("click " + event.target.id), true);
      const holder = document.createElement("div");
      holder.innerHTML = '<div id="w" role="${role_of_widget}" ${widget_attrs} style="width:600px;margin:20px">' + Array.from({ length: ${ROWS} }, (_, index) => '<div id="r' + index + '" role="${role_of_row}" ${row_attrs} style="height:40px;width:600px;box-sizing:border-box">row ' + index + ' with a subject line</div>').join("") + '</div>';
      document.body.prepend(holder);
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);

  await run_case("I picks a grid of link-less rows, j and k put the focus on each row and Enter clicks the row", async () => {
    await open_page("page", "aria_grid", { new_tab: true });
    await draw("", 'tabindex="-1"', "grid", "row");
    await press_keys("I");
    await poll_until("item mode", async () => (await badge()) === "ITEM");
    await expect_focus("r0");
    await press_keys("j");
    await expect_focus("r1");
    await box_on("r1");
    await press_keys("j");
    await expect_focus("r2");
    await press_keys("k");
    await expect_focus("r1");
    await press_keys("-k", "Return");
    await poll_until("a click on the row", async () => JSON.parse(await logged()).includes("click r1"));
    expect(JSON.parse(await logged()).includes("focus r1"), "a focusin handler did not see the row");
  });

  await run_case("a listbox that names its active option keeps the focus: no option takes it, the box shows the option, and Enter clicks it again after the box cleared", async () => {
    await open_page("page", "aria_active", { new_tab: true });
    await draw('tabindex="0" aria-activedescendant="r0"', "", "listbox", "option");
    await in_active_tab(`document.getElementById("w").focus(); true`);
    await press_keys("I");
    await poll_until("item mode", async () => (await badge()) === "ITEM");
    await box_on("r0");
    await press_keys("j");
    await press_keys("j");
    await box_on("r2");
    expect((await focused()) === "w", `the focus left the listbox for ${await focused()}`);
    await press_keys("-k", "Return");
    await poll_until("a click on the option", async () => JSON.parse(await logged()).includes("click r2"));
    // The box clears at the next tick after a key, since the focus is not in the row. The action does not need it.
    await poll_until("the box to clear", async () => (await in_active_tab(READ_BOX)) === null);
    await press_keys("-k", "Return");
    await poll_until("a second click", async () => JSON.parse(await logged()).filter((entry) => entry === "click r2").length === 2);
    const focus_events = JSON.parse(await logged()).filter((entry) => entry.startsWith("focus r"));
    expect(focus_events.length === 0, `an option took the focus: ${focus_events}`);
    await press_keys("j");
    await box_on("r3");
    expect((await focused()) === "w", "j took the focus from the listbox");
  });

  await run_case("a page that holds an ARIA grid does not start item mode, and no key walks it before it is picked", async () => {
    await open_page("page", "aria_none", { new_tab: true });
    await draw("", 'tabindex="-1"', "grid", "row");
    await sleep(1500);
    expect((await badge()) === "NORMAL", `the badge is ${await badge()}`);
    await press_keys("-k", "Escape");
    expect((await focused()) === "", "a row took the focus without a pick");
  });
}
