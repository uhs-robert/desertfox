// Moving a site dropdown from the keyboard: Ctrl+J and Ctrl+K walk an ARIA combobox from its text field, and j and k walk a menu whose item holds the focus. The /dropdown_widgets page records the option its own script landed on in `data-active`.
export const areas = ["keys", "scroll"];

import { CTRL } from "./harness.mjs";

export async function run_cases({ run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  const active = () => in_active_tab(`document.documentElement.dataset.active`);
  const focus = (id) => in_active_tab(`document.getElementById(${JSON.stringify(id)}).focus(); 0`);
  async function expect_active(wanted) {
    await poll_until(`the active option to be ${wanted}`, async () => (await active()) === wanted, { timeout_ms: 3000, expected_timeout: true }).catch(async () => expect(false, `the active option is ${await active()}, expected ${wanted}`));
  }
  const open_widgets = (id) => open_page("dropdown_widgets", `dropdown_${id}`, { new_tab: true });

  await run_case("in an expanded combobox field, Ctrl+J and Ctrl+K move the active option and type nothing", async () => {
    await open_widgets("combo");
    await focus("combo");
    await press_keys(...CTRL("j"));
    await expect_active("c2");
    await press_keys(...CTRL("j"));
    await expect_active("c3");
    await press_keys(...CTRL("k"));
    await expect_active("c2");
    expect((await in_active_tab(`document.getElementById("combo").value`)) === "", "a chord typed into the field");
  });

  await run_case("on a focused menu item, j and k move to the next and previous item", async () => {
    await open_widgets("menu");
    await focus("m1");
    await press_keys("j");
    await expect_active("m2");
    await press_keys("j");
    await expect_active("m3");
    await press_keys("k");
    await expect_active("m2");
    expect((await in_active_tab(`scrollY`)) === 0, "j or k scrolled the page");
  });

  await run_case("with nothing focused, j still scrolls the page", async () => {
    await open_widgets("scroll");
    await press_keys("j");
    await poll_until("the page to scroll", async () => (await in_active_tab(`scrollY`)) > 0, { timeout_ms: 3000, expected_timeout: true }).catch(() => expect(false, "j did not scroll"));
    await sleep(100);
    expect((await active()) === "", "j moved a dropdown");
  });
}
