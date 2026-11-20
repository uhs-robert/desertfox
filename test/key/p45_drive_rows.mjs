// The shipped drive row on a test address with the site pattern swapped, against a stand-in for Drive's file views as read on a live page. Both views are a role=grid: the grid view puts every file in one role=row as a role=gridcell, the list view is a table with one role=row per file. Each file has a data-id, and so do parts inside it. As on Drive, the files scroll in an inner panel that draws only the files near the view and can load a long list in parts as the panel reaches its bottom, and a key handler on the page moves the selection on the arrow keys sent to a file, scrolls the panel and draws the files it needs. Like Drive, it ignores Home and End, numbers list rows with aria-rowindex and gives aria-rowcount as the files it has loaded, and selects a file only through an arrow key: a focused file alone is not selected, and Enter opens the selected file. An arrow that cannot move selects nothing. A view toggle keeps the focus after it flips the view.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config", "bundles", "hints"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);
const FILES = 60;

export async function run_cases({ run_line, config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  // The command line enters item mode on any page, with or without a list. The key after it lands in item mode once the badge says ITEM.
  const enter_item_mode = async () => {
    await run_line("mode item");
    await poll_until("item mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "ITEM");
  };
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
  // With `drop_fast_arrows`, the page drops an arrow that comes within about 100 ms of the previous one, as real Drive does. It is off by default: only the cases that prove the I fix turn it on.
  const open_drive = async (id, view, files = FILES, part = files, drop_fast_arrows = false) => {
    await open_page("controls", `drive_${id}`, { new_tab: true });
    await enter_item_mode();
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
      const select = (index) => {
        if (index < 0 || index >= loaded) return;
        selected = index;
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
        if (event.key === "Enter") { if (selected >= 0) location.hash = "opened-" + prefix() + selected; }
        else if (steps[event.key]) {
          if (${drop_fast_arrows} && performance.now() - (window.last_arrow ?? -1000) < 100) { window.last_arrow = performance.now(); event.preventDefault(); return; }
          window.last_arrow = performance.now();
          panel.dataset.arrows = String(Number(panel.dataset.arrows ?? 0) + 1); panel.dataset.order = (panel.dataset.order ?? "") + event.key.slice(5) + " "; select(index + steps[event.key]());
        } else return;
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
  const selected_file = async () => Number(await in_active_tab(`document.getElementById("panel").dataset.selected ?? -1`));
  const arrows_sent = async () => Number(await in_active_tab(`document.getElementById("panel").dataset.arrows ?? 0`));
  const hash = () => in_active_tab("location.hash");
  const arrow_order = () => in_active_tab(`document.getElementById("panel").dataset.order ?? ""`);
  const view_of = () => in_active_tab(`document.querySelector('[role="gridcell"]') !== null ? "grid" : "list"`);

  await run_case("list view: j takes the focus into the files from nowhere and moves down, and k moves up", async () => {
    await open_drive("list", "list");
    await press_keys("j");
    await expect_focus("f1");
    await press_keys("j");
    await expect_focus("f2");
    await press_keys("k");
    await expect_focus("f1");
    expect((await selected_file()) === 1, `j and k selected ${await selected_file()}`);
  });

  await run_case("list view: I from normal mode lands on a file with no arrow key and starts item mode", async () => {
    await open_drive("list_pick", "list");
    await press_keys("-k", "Escape");
    await poll_until("normal mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "NORMAL");
    await press_keys("I");
    await poll_until("item mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "ITEM");
    await expect_focus("f0");
    await sleep(300);
    expect((await arrows_sent()) === 0, `the landing sent ${await arrows_sent()} arrow keys`);
    await press_keys("j");
    await poll_until("the next file selected", async () => (await selected_file()) >= 1);
  });

  // A list of titled cards beside the files, which the finder reads as a list of its own. Drive's arrows cannot walk it, so the picker never offers it.
  await run_case("list view: I inside item mode still offers the files alone and lands on one at once, though another list is on the page", async () => {
    await open_drive("list_decoy", "list");
    await in_active_tab(`(() => {
      const decoy = document.createElement("div");
      decoy.style.cssText = "position:absolute;top:0;left:500px;width:400px";
      decoy.innerHTML = Array.from({ length: 4 }, (_, index) => '<div class="card" style="height:60px;margin:0 0 10px 0;width:400px"><h3 style="margin:0"><a id="d' + index + '" href="#d' + index + '">Decoy list result number ' + index + ' title</a></h3></div>').join("");
      document.body.prepend(decoy);
      document.activeElement?.blur();
      window.scrollTo(0, 0);
      return true;
    })()`);
    await press_keys("I");
    await expect_focus("f0");
    const labels = await in_active_tab(`[...document.documentElement.children].reduce((sum, child) => sum + (child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint").length ?? 0), 0)`);
    expect(labels === 0, `${labels} labels showed, the picker offered more than the files`);
    expect((await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "ITEM", "item mode ended");
  });

  // The picker lands on the first file, so the selected file must differ from it and from the one a Down from it reaches (grid file 3). The grid takes two j, a line each, to reach file 6.
  for (const view of ["list", "grid"]) {
    const wanted = view === "grid" ? 6 : 3;
    await run_case(`${view} view: I after j, Escape keeps file ${wanted} selected`, async () => {
      await open_drive(`${view}_keep`, view, FILES, FILES, true);
      for (let count = 0; count < (view === "grid" ? 2 : 3); count++) { await press_keys("j"); await sleep(300); }
      await poll_until(`file ${wanted} selected`, async () => (await selected_file()) === wanted);
      await press_keys("-k", "Escape");
      await poll_until("normal mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "NORMAL");
      await press_keys("I");
      await poll_until("item mode", async () => (await in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`)) === "ITEM");
      await sleep(600);
      expect((await selected_file()) === wanted, `I left file ${await selected_file()} selected`);
    });
  }

  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode")`);
  const open_drive_in_normal_mode = async (id, view = "list") => {
    await open_drive(id, view);
    await press_keys("-k", "Escape");
    await poll_until("normal mode", async () => (await badge()) === "NORMAL");
  };

  // The leaf of I sends no arrow. A j typed behind the pick waits for the pick, so it moves from the file the pick landed on: one arrow in all.
  await run_case("list view: I then j typed together selects the second file, with the arrows in order", async () => {
    await open_drive_in_normal_mode("list_pick_fast");
    await press_keys("I", "j");
    await poll_until("j to select the second file", async () => (await selected_file()) === 1 && (await arrows_sent()) === 1);
    await sleep(500);
    expect((await selected_file()) === 1 && (await arrows_sent()) === 1, `the select ended on ${await selected_file()} after ${await arrows_sent()} arrows`);
    expect((await arrow_order()) === "Down ", `the arrows went out as ${await arrow_order()}`);
    expect((await badge()) === "ITEM", "item mode ended");
  });

  // Where the Escape lands depends on timing: in the pick it cancels the picker, behind the pick it waits for the leaf and then leaves item mode. Either way the mode ends and no key stays held.
  // The first I loaded hints.js into the frame. A second I then reaches the hint handler inside the call that starts its leaf, so the leaf it must wait for is the one still being named.
  await run_case("list view: a second I with hints.js already loaded still holds j until the select has landed", async () => {
    await open_drive_in_normal_mode("list_pick_warm");
    await press_keys("I");
    await expect_focus("f0");
    await press_keys("-k", "Escape");
    await poll_until("normal mode", async () => (await badge()) === "NORMAL");
    await press_keys("I", "j");
    await poll_until("j to select the next file", async () => (await arrows_sent()) === 1);
    await sleep(500);
    expect((await arrow_order()) === "Down ", `the arrows went out as ${await arrow_order()}`);
    expect((await badge()) === "ITEM", "item mode ended");
  });

  await run_case("list view: Escape typed behind I and j leaves item mode and holds nothing back", async () => {
    await open_drive_in_normal_mode("list_pick_escape");
    await press_keys("I", "j", "-k", "Escape");
    await poll_until("normal mode", async () => (await badge()) === "NORMAL");
    await sleep(500);
    expect((await badge()) === "NORMAL", "item mode came back");
    await press_keys("j");
    await poll_until("the next j to scroll the page", async () => (await in_active_tab("scrollY")) > 0);
  });

  // The page goes away while the keys wait, and comes back from the history: nothing stays held.
  await run_case("list view: leaving the page right after I and j and coming back leaves no key held", async () => {
    await open_drive_in_normal_mode("list_pick_leave");
    await press_keys("I", "j");
    await in_active_tab(`location.href = "/controls?id=leave_other"; 0`);
    await poll_until("the other page", async () => (await in_active_tab("location.search").catch(() => "")) === "?id=leave_other");
    await sleep(500);
    await in_active_tab("history.back(); 0");
    await poll_until("the drive page again", async () => (await in_active_tab("location.search").catch(() => "")) === "?id=drive_list_pick_leave");
    await sleep(800);
    await press_keys("-k", "Escape");
    await poll_until("normal mode", async () => (await badge()) === "NORMAL");
    await press_keys("j");
    await poll_until("scrolled", async () => (await in_active_tab("scrollY")) > 0);
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

  // A pin on the first file would drag the panel back to it. The stand-in draws two lines beyond the panel, so a scroll of two lines keeps f0 drawn, and a negative margin lifts the panel so f0 lies above the window.
  await run_case("list view: j after gg and a scroll of the panel does not drag the panel back to the first file", async () => {
    await open_drive("list_pin", "list", 2000);
    await press_keys("gg");
    await expect_focus("f0");
    await in_active_tab('(() => { const panel = document.getElementById("panel"); panel.style.marginTop = "-200px"; panel.scrollTop = 60; return true; })()');
    await expect_focus("f0");
    await press_keys("j");
    await sleep(500);
    const top = await panel_top();
    expect(top >= 60, `j dragged the panel back to ${top}`);
  });

  await run_case("list view: G follows a list that loads in parts to the last file", async () => {
    await open_drive("list_fetch", "list", 250, 100);
    await press_keys("G");
    // The stand-in redraws its rows on each scroll and drops the focus a redraw replaces, so only the end of the follow is stable: the focus lands on the last file.
    // Three parts load 300 ms apart, then the follow waits out its 1 s stall, so the default 5 s leaves too little margin on a loaded machine.
    await poll_until("G to focus the last file", async () => (await focused()) === "f249", { timeout_ms: 15000 });
    expect((await arrows_sent()) === 0, `G sent ${await arrows_sent()} arrow keys`);
  });

  // Escape also blurs the file, so the check reads the panel's scroll: a follow that went on would scroll it to the next part.
  await run_case("list view: a key during G stops following the end", async () => {
    await open_drive("list_cancel", "list", 400, 100);
    await press_keys("G");
    await expect_focus("f99");
    await press_keys("-k", "Escape");
    const stopped_at = await panel_top();
    // The next part lands 300 ms after G reached the bottom.
    await sleep(800);
    expect((await panel_top()) === stopped_at, `G went on after Escape, from ${stopped_at} to ${await panel_top()}`);
  });

  await run_case("list view: k pressed right after G or gg runs after the end key has landed", async () => {
    await open_drive("list_held", "list");
    await press_keys("G", "k");
    await poll_until("k to move the selection up from the last file", async () => (await arrows_sent()) === 1 && (await selected_file()) === FILES - 2);
    await press_keys("gg", "j");
    await poll_until("j to move the selection down from the first file", async () => (await arrows_sent()) === 2 && (await selected_file()) === 1);
  });

  // 59 files make the last grid line short, so G must focus g58 and not a cell that is not there.
  await run_case("grid view with a short last line: G focuses the last file and gg the first", async () => {
    await open_drive("grid_short", "grid", 59);
    await press_keys("G");
    await expect_focus("g58");
    await press_keys("gg");
    await expect_focus("g0");
  });

  // Known gap: with one file no arrow can move, so j gives the file the box and Drive selects nothing.
  await run_case("list view with one file: G boxes it, j selects nothing and item mode stays", async () => {
    await open_drive("list_one", "list", 1);
    await press_keys("G");
    await expect_focus("f0");
    await press_keys("j");
    await sleep(300);
    expect((await selected_file()) === -1, "the file was selected");
    expect((await in_active_tab("document.querySelector('[data-desertfox-mode]')?.getAttribute('data-desertfox-mode')")) === "ITEM", "item mode ended");
  });

  // gg and G send no arrow, so a count on them sends none and Drive's selection stays where it was.
  await run_case("list view: a count on G and gg sends no arrow and leaves Drive's selection alone", async () => {
    await open_drive("list_count", "list");
    for (const [keys, wanted] of [["3G", `f${FILES - 1}`], ["100gg", "f0"], ["100G", `f${FILES - 1}`]]) {
      await press_keys(keys);
      await expect_focus(wanted);
      expect((await arrows_sent()) === 0, `${keys} sent ${await arrows_sent()} arrows`);
      expect((await selected_file()) === -1, `${keys} selected ${await selected_file()}`);
    }
  });

  await run_case("list view that loads in parts: k pressed during the follow of G stops it, k moves up from the file reached", async () => {
    await open_drive("list_held_follow", "list", 400, 100);
    await press_keys("G", "k");
    await poll_until("the arrow to go out", async () => (await arrows_sent()) === 1);
    await sleep(500);
    const selected = await selected_file();
    expect(selected > 0 && selected < 399, `the select landed on ${selected}`);
    expect((await arrows_sent()) === 1, `${await arrows_sent()} arrows went out`);
    expect((await focused()) === `f${selected}`, `the focus is on ${await focused()}`);
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
    expect((await selected_file()) === 4, `h, l and j selected ${await selected_file()}`);
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
    await enter_item_mode();
    await press_keys("G");
    await poll_until("G to scroll down", async () => (await in_active_tab("scrollY")) > 0);
    await press_keys("gg");
    await poll_until("gg to scroll to the top", async () => (await in_active_tab("scrollY")) === 0);
  });
}
