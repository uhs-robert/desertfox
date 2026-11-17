// The shipped drive rows on a test address with the site pattern swapped, against a stand-in for Drive's file list: a role=listbox of role=option files (grid view) or a role=grid of role=row files (list view), and a view toggle button that keeps the focus after it flips the view, as Drive's does. The Drive roles are not checked on a live page.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config", "bundles"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);
const FILES = 7;

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect }) {
  await setup("load the shipped drive rows on the drive_ test pages", async () => {
    const dir = config_copy();
    const lines = [];
    for (const { name, row } of DEFAULT_SITE_ROWS) {
      if (name !== "drive") continue;
      const { site: _site, ...columns } = row;
      lines.push("", "[[site_rules]]", `site = "*://127.0.0.1/*?id=drive_*"`, ...Object.entries(columns).map(([column, value]) => `${column} = ${toml(value)}`));
    }
    appendFileSync(join(dir, "settings.toml"), [...lines, ""].join("\n"));
    await load_config_dir(dir);
  });

  // Three files per row in the grid. Enter on a focused file sets the hash to opened-<id>, as Drive's own key handler opens it.
  const open_drive = async (id, view) => {
    await open_page("controls", `drive_${id}`, { new_tab: true });
    await in_active_tab(`(() => {
      const root = document.createElement("div");
      document.body.prepend(root);
      const draw = (view) => {
        const file = (index) => '<div ' + (view === "grid" ? 'role="option" style="display:inline-block;width:100px;height:60px;margin:0 10px 10px 0"' : 'role="row" style="height:30px"') + ' data-id="f' + index + '" id="f' + index + '" tabindex="0">file ' + index + '</div>';
        const files = Array.from({ length: ${FILES} }, (_, index) => file(index)).join("");
        root.innerHTML = '<button id="toggle">toggle view</button><div id="width" style="width:340px">' + (view === "grid" ? '<div role="listbox">' : '<div role="grid"><div role="row" id="head">name</div>') + files + '</div></div>';
        document.getElementById("toggle").onclick = () => draw(view === "grid" ? "list" : "grid");
        for (const element of root.querySelectorAll("[data-id]")) element.onkeydown = (event) => { if (event.key === "Enter") location.hash = "opened-" + element.id; };
      };
      draw(${JSON.stringify(view)});
      location.hash = "before";
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);
  };
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);

  await run_case("grid view: j takes the focus into the files from nowhere, and h and l step along the row", async () => {
    await open_drive("grid", "grid");
    await press_keys("j");
    await expect_focus("f0");
    await press_keys("l");
    await expect_focus("f1");
    await press_keys("h");
    await expect_focus("f0");
    await press_keys("j");
    await expect_focus("f3");
  });

  await run_case("gg and G go to the first and last file", async () => {
    await open_drive("ends", "grid");
    await press_keys("G");
    await expect_focus(`f${FILES - 1}`);
    await press_keys("gg");
    await expect_focus("f0");
  });

  await run_case("with the focus on the view toggle, a key moves the files and does not flip the view", async () => {
    await open_drive("toggle", "grid");
    await in_active_tab(`document.getElementById("toggle").focus()`);
    await press_keys("l");
    await expect_focus("f0");
    expect((await in_active_tab(`document.querySelector('[role="listbox"]') !== null`)) === true, "the view flipped");
  });

  await run_case("list view: j and k walk the rows, l opens the focused row and h goes back", async () => {
    await open_drive("list", "list");
    await press_keys("jj");
    await expect_focus("f1");
    await press_keys("l");
    await poll_until("Enter to open the row", async () => (await in_active_tab("location.hash")) === "#opened-f1");
    await press_keys("h");
    await poll_until("h to go back in history", async () => (await in_active_tab("location.hash")) === "#before");
  });

  await run_case("on a page with no file list, gg and G scroll as usual", async () => {
    await open_page("controls", "drive_empty", { new_tab: true });
    await press_keys("G");
    await poll_until("G to scroll down", async () => (await in_active_tab("scrollY")) > 0);
    await press_keys("gg");
    await poll_until("gg to scroll to the top", async () => (await in_active_tab("scrollY")) === 0);
  });
}
