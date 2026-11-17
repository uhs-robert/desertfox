// The shipped drive row on a test address with the site pattern swapped, against a stand-in for Drive's file list: a role=listbox of role=option files (grid view) or a role=grid of role=row files (list view), and a view toggle button that keeps the focus after it flips the view, as Drive's does. The Drive roles are not checked on a live page.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config", "bundles"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);
const FILES = 7;

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect }) {
  await setup("load the shipped drive row on the drive_ test pages", async () => {
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

  // Enter on a focused file sets the hash to opened-<id>, as Drive's own key handler opens it. Grid files are g0.., list files f0... A layout names the views the page holds: "grid", "list", "list+hidden_grid" (a grid left in the page under display:none) or "both" (a grid above a list).
  const open_drive = async (id, layout) => {
    await open_page("controls", `drive_${id}`, { new_tab: true });
    await in_active_tab(`(() => {
      const root = document.createElement("div");
      document.body.prepend(root);
      const file = (view, index) => '<div ' + (view === "grid" ? 'role="option" style="display:inline-block;width:100px;height:60px;margin:0 10px 10px 0"' : 'role="row" style="height:30px"') + ' data-id="x' + index + '" id="' + (view === "grid" ? "g" : "f") + index + '" tabindex="0">file ' + index + '</div>';
      const files = (view) => Array.from({ length: ${FILES} }, (_, index) => file(view, index)).join("");
      const grid = (hidden) => '<div style="width:340px' + (hidden ? ";display:none" : "") + '"><div role="listbox">' + files("grid") + '</div></div>';
      const list = () => '<div role="grid"><div role="row" id="head">name</div>' + files("list") + '</div>';
      const draw = (layout) => {
        const views = { grid: grid(false), list: list(), "list+hidden_grid": grid(true) + list(), both: grid(false) + list() };
        root.innerHTML = '<button id="toggle">toggle view</button>' + views[layout];
        document.getElementById("toggle").onclick = () => draw(layout === "grid" ? "list" : "grid");
        for (const element of root.querySelectorAll("[data-id]")) element.onkeydown = (event) => { if (event.key === "Enter") location.hash = "opened-" + element.id; };
      };
      draw(${JSON.stringify(layout)});
      location.hash = "before";
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);
  };
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);
  const expect_hash = (wanted) => poll_until(`the hash ${wanted}`, async () => (await in_active_tab("location.hash")) === `#${wanted}`);
  const view_of = () => in_active_tab(`document.querySelector('[role="listbox"]') !== null ? "grid" : "list"`);

  await run_case("grid view: j takes the focus into the files from nowhere, and h and l step along the row", async () => {
    await open_drive("grid", "grid");
    await press_keys("j");
    await expect_focus("g0");
    await press_keys("l");
    await expect_focus("g1");
    await press_keys("h");
    await expect_focus("g0");
    await press_keys("j");
    await expect_focus("g3");
  });

  await run_case("gg and G go to the first and last file", async () => {
    await open_drive("ends", "grid");
    await press_keys("G");
    await expect_focus(`g${FILES - 1}`);
    await press_keys("gg");
    await expect_focus("g0");
  });

  await run_case("grid view with the focus on the view toggle: l moves into the files and does not flip the view", async () => {
    await open_drive("toggle", "grid");
    await in_active_tab(`document.getElementById("toggle").focus()`);
    await press_keys("l");
    await expect_focus("g0");
    expect((await view_of()) === "grid", "the view flipped");
  });

  await run_case("list view: j and k walk the rows, l opens the focused row and h goes back", async () => {
    await open_drive("list", "list");
    await press_keys("jj");
    await expect_focus("f1");
    await press_keys("l");
    await expect_hash("opened-f1");
    await press_keys("h");
    await expect_hash("before");
  });

  await run_case("list view with the focus on the view toggle: l opens a row and does not flip the view", async () => {
    await open_drive("list_toggle", "list");
    await in_active_tab(`document.getElementById("toggle").focus()`);
    await press_keys("l");
    await expect_hash("opened-f0");
    expect((await view_of()) === "list", "the view flipped");
  });

  await run_case("list view with nothing focused: l opens the first row", async () => {
    await open_drive("list_none", "list");
    await press_keys("l");
    await expect_hash("opened-f0");
  });

  await run_case("a hidden leftover grid does not turn the list keys into grid keys", async () => {
    await open_drive("leftover", "list+hidden_grid");
    await press_keys("l");
    await expect_hash("opened-f0");
    await press_keys("h");
    await expect_hash("before");
  });

  await run_case("a page that shows both views gets the list keys", async () => {
    await open_drive("both", "both");
    await press_keys("l");
    await expect_hash("opened-f0");
    await press_keys("h");
    await expect_hash("before");
  });

  await run_case("on a page with no file list, gg and G scroll as usual", async () => {
    await open_page("controls", "drive_empty", { new_tab: true });
    await press_keys("G");
    await poll_until("G to scroll down", async () => (await in_active_tab("scrollY")) > 0);
    await press_keys("gg");
    await poll_until("gg to scroll to the top", async () => (await in_active_tab("scrollY")) === 0);
  });
}
