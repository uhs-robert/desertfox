// `page.click` from a site row bind, on a stand-in for a control that a site's script opens on a click and ignores Enter on. A hidden copy of the control comes first in the page, as a closed menu or the other view keeps one.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["hints", "config"];

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  await setup("bind zc to page.click .go on the click_ pages", async () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), ["", "[[site_rules]]", 'site = "*://127.0.0.1/*?id=click_*"', 'bind = { zc = "page.click .go" }', ""].join("\n"));
    await load_config_dir(dir);
  });

  // Each control writes the events it got into its data-events attribute, and a click sets the hash to the control's id.
  const open_controls = async (id, hidden_only = false) => {
    await open_page("controls", `click_${id}`, { new_tab: true });
    await in_active_tab(`(() => {
      const root = document.createElement("div");
      root.innerHTML = '<div role="link" class="go" id="hidden" tabindex="-1" style="display:none">hidden</div>' + (${hidden_only} ? "" : '<div role="link" class="go" id="shown" tabindex="-1">shown</div>');
      document.body.prepend(root);
      for (const control of root.querySelectorAll(".go")) {
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "keydown"]) control.addEventListener(type, () => { control.dataset.events = (control.dataset.events ?? "") + type + " "; });
        control.addEventListener("click", () => { location.hash = control.id; });
      }
      location.hash = "before";
      document.activeElement?.blur();
      return true;
    })()`);
  };

  await run_case("page.click clicks the first shown match with the pointer and mouse events of a hint click", async () => {
    await open_controls("shown");
    await press_keys("zc");
    await poll_until("the shown control to be clicked", async () => (await in_active_tab("location.hash")) === "#shown");
    const events = await in_active_tab(`document.getElementById("shown").dataset.events`);
    expect(events === "pointerdown mousedown pointerup mouseup click ", `the shown control got ${events}`);
    expect((await in_active_tab(`document.getElementById("hidden").dataset.events ?? ""`)) === "", "the hidden copy got events");
  });

  await run_case("page.click with only a hidden match clicks nothing", async () => {
    await open_controls("hidden_only", true);
    await press_keys("zc");
    await sleep(300);
    expect((await in_active_tab("location.hash")) === "#before", "a hidden control was clicked");
  });
}
