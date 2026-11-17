// The shipped drive row on a test address with the site pattern swapped, against a stand-in for Drive's file views as read on a live page. Both views are a role=grid: the grid view puts every file in one role=row as a role=gridcell, the list view is a table with one role=row per file. Each file has a data-id, and so do parts inside it. As on Drive, the files scroll in an inner panel that draws only the files near the view and can load a long list in parts as the panel reaches its bottom, and a key handler on the page moves the selection on the arrow keys sent to a file, scrolls the panel and draws the files it needs. Like Drive, it ignores Home and End, numbers list rows with aria-rowindex and gives aria-rowcount as the files it has loaded, and takes a focused file as its selection. A view toggle keeps the focus after it flips the view.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config", "bundles"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);
const FILES = 60;

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

  // Grid files are g0.., list files f0... The grid has three files a line. The panel is 300 px tall, so it shows about 10 list rows or 4 grid lines, and it draws two lines more on each side. Enter on a file sets the hash to opened-<id>. With `part`, the panel holds that many files at first and loads `part` more 300 ms after it reaches its bottom, as Drive fetches the next part of a long list. The page is wide, so the document scrolls sideways.
  const open_drive = async (id, view, files = FILES, part = files) => {
    await open_page("controls", `drive_${id}`, { new_tab: true });
    await in_active_tab(`(() => {
      const root = document.createElement("div");
      root.style.width = "3000px";
      document.body.prepend(root);
      let view = ${JSON.stringify(view)};
      let selected = -1;
      const per_line = () => (view === "grid" ? 3 : 1);
      const line_px = () => (view === "grid" ? 70 : 30);
      const prefix = () => (view === "grid" ? "g" : "f");
      const thumb = (index) => '<div data-id="x' + index + '"></div>';
      const file = (index) => view === "grid"
        ? '<div role="gridcell" style="display:inline-block;width:100px;height:60px;margin:0 10px 10px 0;vertical-align:top" data-id="x' + index + '" id="g' + index + '" tabindex="' + (index === Math.max(selected, 0) ? 0 : -1) + '">' + thumb(index) + 'file ' + index + '</div>'
        : '<tr role="row" style="height:30px" aria-rowindex="' + (index + 1) + '" data-id="x' + index + '" id="f' + index + '" tabindex="' + (index === Math.max(selected, 0) ? 0 : -1) + '"><td>' + thumb(index) + 'file ' + index + '</td></tr>';
      let loaded = ${part};
      let loading = false;
      const lines = () => Math.ceil(loaded / per_line());
      root.innerHTML = '<div role="radiogroup"><button role="radio" id="toggle">toggle view</button></div><div id="panel" style="height:300px;width:360px;overflow-y:auto"></div>';
      const panel = document.getElementById("panel");
      const draw = () => {
        const first_line = Math.max(0, Math.floor(panel.scrollTop / line_px()) - 2);
        const last_line = Math.min(lines(), Math.ceil((panel.scrollTop + 300) / line_px()) + 2);
        const files = [];
        for (let index = first_line * per_line(); index < Math.min(loaded, last_line * per_line()); index++) files.push(file(index));
        const above = first_line * line_px();
        const below = (lines() - last_line) * line_px();
        panel.innerHTML = view === "grid"
          ? '<div role="grid"><div style="height:' + above + 'px"></div><div role="row">' + files.join("") + '</div><div style="height:' + below + 'px"></div></div>'
          : '<table role="grid" aria-rowcount="' + loaded + '" style="border-spacing:0"><thead><tr role="row"><th>name</th></tr></thead><tbody><tr style="height:' + above + 'px"></tr>' + files.join("") + '<tr style="height:' + below + 'px"></tr></tbody></table>';
        document.getElementById(prefix() + selected)?.focus({ preventScroll: true });
        if (!loading && loaded < ${files} && panel.scrollTop + 300 >= panel.scrollHeight - 1) {
          loading = true;
          setTimeout(() => { loaded = Math.min(${files}, loaded + ${part}); loading = false; draw(); }, 300);
        }
      };
      panel.addEventListener("scroll", draw);
      panel.addEventListener("focusin", (event) => {
        const file = event.target.closest('[role="gridcell"][data-id], tr[data-id]');
        if (file) panel.dataset.selected = String((selected = Number(file.id.slice(1))));
      });
      const select = (index) => {
        selected = Math.max(0, Math.min(loaded - 1, index));
        panel.dataset.selected = String(selected);
        const top = Math.floor(selected / per_line()) * line_px();
        if (top < panel.scrollTop) panel.scrollTop = top;
        else if (top + line_px() > panel.scrollTop + 300) panel.scrollTop = top + line_px() - 300;
        draw();
      };
      const flip = () => { view = view === "grid" ? "list" : "grid"; selected = -1; panel.scrollTop = 0; draw(); };
      const toggle = document.getElementById("toggle");
      toggle.onclick = flip;
      toggle.onkeydown = (event) => { if (event.key === "Enter") flip(); };
      // Drive reads the keys on the page and acts on the file the event comes from, or on its selection when the focus left the files.
      const steps = { ArrowDown: () => per_line(), ArrowUp: () => -per_line(), ArrowLeft: () => -1, ArrowRight: () => 1 };
      document.addEventListener("keydown", (event) => {
        const target = event.target.closest?.('[role="gridcell"][data-id], tr[data-id]');
        if (!target && selected < 0) return;
        const index = target ? Number(target.id.slice(1)) : selected;
        if (event.key === "Enter") location.hash = "opened-" + (target?.id ?? "");
        else if (steps[event.key]) select(index + steps[event.key]());
        else return;
        event.preventDefault();
      });
      draw();
      location.hash = "before";
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);
  };
  const focused = () => in_active_tab("document.activeElement?.id ?? ''");
  const expect_focus = (wanted) => poll_until(`focus on ${wanted}`, async () => (await focused()) === wanted);
  const panel_top = () => in_active_tab(`document.getElementById("panel").scrollTop`);
  const view_of = () => in_active_tab(`document.querySelector('[role="gridcell"]') !== null ? "grid" : "list"`);

  await run_case("list view: j takes the focus into the files from nowhere and moves down, and k moves up", async () => {
    await open_drive("list", "list");
    await press_keys("j");
    await expect_focus("f1");
    await press_keys("j");
    await expect_focus("f2");
    await press_keys("k");
    await expect_focus("f1");
  });

  await run_case("list view: j walks past the drawn rows, and the panel scrolls to draw more", async () => {
    await open_drive("list_far", "list");
    await press_keys("j");
    await expect_focus("f1");
    for (let press = 0; press < 18; press++) await press_keys("j");
    await expect_focus("f19");
    expect((await panel_top()) > 0, "the panel did not scroll");
    await press_keys("15j");
    await expect_focus("f34");
  });

  // The panel draws about 14 of 2000 rows, so a walk through Drive's arrow keys would take seconds.
  await run_case("list view: G reaches the last file and gg the first quickly, past the drawn rows", async () => {
    await open_drive("list_ends", "list", 2000);
    for (const [keys, wanted, top] of [["G", "f1999", (value) => value > 0], ["gg", "f0", (value) => value === 0]]) {
      const started = Date.now();
      await press_keys(keys);
      await expect_focus(wanted);
      const took = Date.now() - started;
      expect(took < 1000, `${keys} took ${took} ms`);
      expect(top(await panel_top()), `${keys} left the panel at ${await panel_top()}`);
    }
  });

  await run_case("list view: G follows a list that loads in parts to the last file", async () => {
    await open_drive("list_fetch", "list", 250, 100);
    await press_keys("G");
    await expect_focus("f99");
    await expect_focus("f249");
  });

  // Escape also blurs the file, so the check reads the stand-in's selection, which follows the focus.
  await run_case("list view: a key during G stops following the end", async () => {
    await open_drive("list_cancel", "list", 400, 100);
    const selected = async () => Number(await in_active_tab(`document.getElementById("panel").dataset.selected ?? -1`));
    await press_keys("G");
    await expect_focus("f99");
    await press_keys("-k", "Escape");
    // The next part lands 300 ms after G reached the bottom.
    await sleep(800);
    expect((await selected()) === 99, `G went on after Escape, to ${await selected()}`);
  });

  await run_case("list view: h and l keep the plain sideways scroll and leave the files alone", async () => {
    await open_drive("list_hl", "list");
    await press_keys("j");
    await expect_focus("f1");
    await press_keys("l");
    await poll_until("l to scroll the page right", async () => (await in_active_tab("scrollX")) > 0);
    await press_keys("h");
    await poll_until("h to scroll the page back", async () => (await in_active_tab("scrollX")) === 0);
    expect((await focused()) === "f1", "h or l moved the focus");
    expect((await in_active_tab("location.hash")) === "#before", "h or l opened a file");
  });

  await run_case("grid view: h and l step along a line, j steps a line, and G and gg reach the ends", async () => {
    await open_drive("grid", "grid");
    await press_keys("l");
    await expect_focus("g1");
    await press_keys("l");
    await expect_focus("g2");
    await press_keys("h");
    await expect_focus("g1");
    await press_keys("j");
    await expect_focus("g4");
    await press_keys("G");
    await expect_focus(`g${FILES - 1}`);
    await press_keys("gg");
    await expect_focus("g0");
  });

  await run_case("grid view with the focus on the view toggle: j moves into the files and does not flip the view", async () => {
    await open_drive("toggle", "grid");
    await in_active_tab(`document.getElementById("toggle").focus()`);
    await press_keys("j");
    await expect_focus("g3");
    expect((await view_of()) === "grid", "the view flipped");
  });

  await run_case("on a page with no file list, gg and G scroll as usual", async () => {
    await open_page("controls", "drive_empty", { new_tab: true });
    await press_keys("G");
    await poll_until("G to scroll down", async () => (await in_active_tab("scrollY")) > 0);
    await press_keys("gg");
    await poll_until("gg to scroll to the top", async () => (await in_active_tab("scrollY")) === 0);
  });
}
