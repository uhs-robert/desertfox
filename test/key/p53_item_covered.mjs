// j and k scroll an item clear when it is inside the window but covered: clipped by the bottom edge of its own scroll box, or under a fixed bar at the top. The `item_covered` page of the test server has both.
export const areas = ["keys"];

export async function run_cases({ run_line, run_case, open_page, press_keys, in_active_tab, poll_until }) {
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);
  // True when the middle of the focused row hits the row itself and not the bar or whatever lies past the box edge.
  const clear = () => in_active_tab(`(() => { const row = document.activeElement.closest(".row"); const box = row.getBoundingClientRect(); const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2); return row.contains(hit); })()`);
  const expect_clear = (what) => poll_until(`${what} clear of the cover`, async () => (await clear()) === true);
  const start = async (id) => {
    await open_page("item_covered", id, { new_tab: true });
    await run_line("mode item");
    await poll_until("item mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "ITEM");
  };

  await run_case("j onto a row that the bottom edge of its scroll box clips scrolls it clear", async () => {
    await start("cov_scroll");
    // Rows 0 to 2 fill the box. Row 3 starts at its edge, inside the window but out of sight.
    for (const row of ["r0", "r1", "r2", "r3"]) {
      await press_keys("j");
      await expect_focus(row);
    }
    await expect_clear("row 3");
  });

  await run_case("k onto a row under the fixed bar scrolls it clear", async () => {
    await start("cov_bar");
    for (const row of ["r0", "r1", "r2", "r3", "r4", "r5"]) {
      await press_keys("j");
      await expect_focus(row);
    }
    await expect_clear("row 5");
    await press_keys("k");
    await expect_focus("r4");
    await expect_clear("row 4");
  });
}
