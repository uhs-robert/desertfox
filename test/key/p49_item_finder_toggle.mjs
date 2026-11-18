// `,j` flips item_finder in an open tab with no reload: on a page with no site row, j walks cards after the first press and scrolls after the second.
export const areas = ["keys", "config", "bundles"];

const CARDS = 10;

export async function run_cases({ run_case, open_page, press_keys, in_active_tab, poll_until, expect }) {
  const toast_text = () => in_active_tab(`[...document.documentElement.children].find((child) => child.style.zIndex === "2147483645")?.openOrClosedShadowRoot?.querySelector(".desertfox-toast")?.textContent ?? ""`);
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const add_cards = () =>
    in_active_tab(`(() => {
      const list = document.createElement("div");
      list.innerHTML = ${JSON.stringify(Array.from({ length: CARDS }, (_, index) => `<div class="card" style="height:100px;margin:0 0 20px 20px;width:500px"><h3 style="margin:0"><a id="f${index}" href="#f${index}">Toggle result number ${index} title</a></h3><span>snippet ${index}</span></div>`).join(""))};
      document.body.prepend(list);
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);

  await run_case(",j turns the item finder on in an open tab and a second ,j turns it off", async () => {
    await open_page("page", "finder_toggle", { new_tab: true });
    await add_cards();
    await press_keys(",j");
    await poll_until("the item_finder = true toast", async () => (await toast_text()).includes("item_finder = true"));
    await press_keys("j");
    await poll_until("focus on f0", async () => (await focused()) === "f0");
    await press_keys(",j");
    await poll_until("the item_finder = false toast", async () => (await toast_text()).includes("item_finder = false"));
    await in_active_tab("(document.activeElement?.blur(), window.scrollTo(0, 0), true)");
    await press_keys("j");
    await poll_until("the page to scroll", async () => (await in_active_tab("scrollY")) > 0);
    expect((await focused()) === "", "j moved the focus with the finder off");
  });
}
