// The shipped drive row on a test address with the site pattern swapped, against a stand-in for Drive's file views as read on a live page. Both views are a role=grid: the grid view puts every file in one role=row as a role=gridcell, the list view is a table with one role=row per file. Each file has a data-id, and so do parts inside it. A breadcrumb in a navigation ends with the current folder after a link to the parent. A view toggle keeps the focus after it flips the view, as Drive's does.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config", "bundles"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);
const FILES = 7;

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
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

  // Enter on a focused file sets the hash to opened-<id>, as Drive's own key handler opens it, and Enter on the parent crumb sets it to parent. Grid files are g0.., list files f0... A layout names the views the page holds: "grid", "list", "list+hidden_grid" (a grid left in the page under display:none) or "both" (a grid above a list). A folder page has a breadcrumb with a parent, a root page only a title.
  const open_drive = async (id, layout, { folder = false } = {}) => {
    await open_page("controls", `drive_${id}`, { new_tab: true });
    await in_active_tab(`(() => {
      const root = document.createElement("div");
      document.body.prepend(root);
      const thumb = (index) => '<div data-id="x' + index + '"></div>';
      const cell = (index) => '<div role="gridcell" style="display:inline-block;width:100px;height:60px;margin:0 10px 10px 0" data-id="x' + index + '" data-target="doc" id="g' + index + '" tabindex="' + (index === 0 ? 0 : -1) + '">' + thumb(index) + 'file ' + index + '</div>';
      const row = (index) => '<tr role="row" style="height:30px" data-id="x' + index + '" data-target="doc" id="f' + index + '" tabindex="' + (index === 0 ? 0 : -1) + '"><td>' + thumb(index) + 'file ' + index + '</td></tr>';
      const many = (make) => Array.from({ length: ${FILES} }, (_, index) => make(index)).join("");
      const grid = (hidden) => '<div style="width:340px' + (hidden ? ";display:none" : "") + '"><div role="grid"><div role="row">' + many(cell) + '</div></div></div>';
      const list = () => '<table role="grid"><thead><tr role="row" id="head"><th>name</th></tr></thead><tbody>' + many(row) + '</tbody></table>';
      const crumbs = ${folder} ? '<div role="list"><div role="listitem"><div role="button" tabindex="0">...</div></div><div role="listitem"><div role="link" data-id="p" data-target="folder" id="parent" tabindex="-1">parent</div></div><div role="listitem"><button>here</button></div></div>' : "";
      const draw = (layout) => {
        const views = { grid: grid(false), list: list(), "list+hidden_grid": grid(true) + list(), both: grid(false) + list() };
        root.innerHTML = '<nav role="navigation"><div role="heading" aria-level="2">title</div>' + crumbs + '</nav><div role="radiogroup"><button role="radio" id="toggle">toggle view</button></div>' + views[layout];
        const toggle = document.getElementById("toggle");
        const flip = () => draw(layout === "grid" ? "list" : "grid");
        toggle.onclick = flip;
        toggle.onkeydown = (event) => { if (event.key === "Enter") flip(); };
        for (const element of root.querySelectorAll('[role="gridcell"], tr[data-id], #parent')) element.onkeydown = (event) => { if (event.key === "Enter") location.hash = element.id === "parent" ? "parent" : "opened-" + element.id; };
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
  const view_of = () => in_active_tab(`document.querySelector('[role="gridcell"]') !== null ? "grid" : "list"`);

  await run_case("grid view in a folder: j takes the focus into the files from nowhere, and h and l step along the row", async () => {
    await open_drive("grid", "grid", { folder: true });
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

  await run_case("list view in a folder: j and k walk the rows, l opens the focused row and h opens the parent folder", async () => {
    await open_drive("list", "list", { folder: true });
    await press_keys("jj");
    await expect_focus("f1");
    await press_keys("l");
    await expect_hash("opened-f1");
    await press_keys("h");
    await expect_hash("parent");
  });

  await run_case("list view on a root page: h does not go back through the history", async () => {
    await open_drive("list_root", "list");
    await press_keys("h");
    // j runs after h, so once it lands h has run too.
    await press_keys("j");
    await expect_focus("f0");
    // Back runs in the background and can land after j, so the check waits for it. Back would leave #before for the address before it.
    await sleep(400);
    expect((await in_active_tab("location.hash")) === "#before", "h changed the address");
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
    await open_drive("leftover", "list+hidden_grid", { folder: true });
    await press_keys("l");
    await expect_hash("opened-f0");
    await press_keys("h");
    await expect_hash("parent");
  });

  await run_case("cards above a list: l opens the focused card, not a list row, and h opens the parent folder", async () => {
    await open_drive("both", "both", { folder: true });
    await press_keys("j");
    await expect_focus("g0");
    await press_keys("l");
    await expect_hash("opened-g0");
    await press_keys("h");
    await expect_hash("parent");
  });

  await run_case("on a page with no file list, gg and G scroll as usual", async () => {
    await open_page("controls", "drive_empty", { new_tab: true });
    await press_keys("G");
    await poll_until("G to scroll down", async () => (await in_active_tab("scrollY")) > 0);
    await press_keys("gg");
    await poll_until("gg to scroll to the top", async () => (await in_active_tab("scrollY")) === 0);
  });
}
