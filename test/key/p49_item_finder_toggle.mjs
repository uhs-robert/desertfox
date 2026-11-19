// `I` flips item_navigator in an open tab with no reload: on a page with no site row, j walks cards after the first press and scrolls after the second.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "config", "bundles"];

const CARDS = 10;

export async function run_cases({ run_case, open_page, press_keys, in_active_tab, poll_until, expect, on_teardown, run_line, config_dir }) {
  const toast_text = () => in_active_tab(`[...document.documentElement.children].find((child) => child.style.zIndex === "2147483645")?.openOrClosedShadowRoot?.querySelector(".desertfox-toast")?.textContent ?? ""`);
  // I writes item_navigator into settings.toml of the base config, which every later piece reads, so the piece removes it again.
  // The unset always runs: a toggle write still out can add the key after a look at the file. Its toast comes after its own write, and the queue runs it after every earlier toggle.
  on_teardown(async () => {
    await run_line(":unset item_navigator");
    await poll_until("the unset of item_navigator to answer", async () => /^(Unset item_navigator|item_navigator is not set)/.test(await toast_text()));
    await poll_until("item_navigator to leave settings.toml", async () => !readFileSync(join(config_dir, "settings.toml"), "utf8").includes("item_navigator"));
  });
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

  await run_case("I turns the item finder on in an open tab and a second I turns it off", async () => {
    await open_page("page", "finder_toggle", { new_tab: true });
    await add_cards();
    await press_keys("I");
    await poll_until("the item_navigator = true toast", async () => (await toast_text()).includes("item_navigator = true"));
    await press_keys("j");
    await poll_until("focus on f0", async () => (await focused()) === "f0");
    await press_keys("I");
    await poll_until("the item_navigator = false toast", async () => (await toast_text()).includes("item_navigator = false"));
    await in_active_tab("(document.activeElement?.blur(), window.scrollTo(0, 0), true)");
    await press_keys("j");
    await poll_until("the page to scroll", async () => (await in_active_tab("scrollY")) > 0);
    expect((await focused()) === "", "j moved the focus with the finder off");
  });
}
