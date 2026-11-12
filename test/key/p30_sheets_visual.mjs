// The shipped Sheets VISUAL mode, on the /grid stand-in. The shipped rows match docs.google.com only, so this piece lays the same binds on a test address: the rows come from the shipped module, with the site pattern swapped.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SITE_ROWS } from "../../src/background/default_site_rows.ts";

export const areas = ["keys", "config", "ui", "bundles"];

const toml = (value) => (typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(toml).join(", ")}]` : `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)} = ${toml(entry)}`).join(", ")} }`);
const shipped = DEFAULT_SITE_ROWS[0].row;
const ROW = ["", "[[site_rules]]", 'site = "*://127.0.0.1/*?id=sv_*"', `bind = ${toml(shipped.bind)}`, `modes.visual = ${toml(shipped.modes.visual)}`, 'pass = "<C-a> <C-x> <C-v>"', `editable_remove = ${toml(shipped.editable_remove)}`, "editable_remove_unsized = true", ""].join("\n");

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, in_background, poll_until, expect, sleep }) {
  await setup("load the shipped Sheets binds as a row for the grid", async () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), ROW);
    await load_config_dir(dir);
  });

  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const seen = () => in_active_tab("document.documentElement.dataset.grid");
  async function expect_badge(label) {
    let now;
    await poll_until(`the ${label} badge`, async () => (now = await badge()) === label, { timeout_ms: 3000, expected_timeout: true }).catch(() => expect(false, `the badge is ${now}, expected ${label}`));
  }
  async function expect_grid(wanted) {
    await poll_until(`grid log ${wanted}`, async () => (await seen()) === wanted, { timeout_ms: 3000, expected_timeout: true }).catch(async () => expect(false, `the grid saw "${await seen()}", expected "${wanted}"`));
    await sleep(200);
    expect((await seen()) === wanted, `the grid changed to ${await seen()}`);
  }
  // The stand-in records clipboard events in order with the arrow codes, so a test sees what came first.
  const hook_clipboard = () => in_active_tab(`for (const type of ["cut", "copy", "paste"]) document.getElementById("waffle-rich-text-editor").addEventListener(type, () => (document.documentElement.dataset.grid += type + ",")); 0`);
  const open_grid = (id) => open_page("grid", `sv_${id}`, { new_tab: true });
  const seed_clipboard = (text) => in_background(`navigator.clipboard.writeText(${JSON.stringify(text)}).then(() => true)`);

  await run_case("v then hjkl sends Shift arrows, and Ctrl+h sends Ctrl+Shift", async () => {
    await open_grid("move");
    await press_keys("v");
    await expect_badge("VISUAL");
    await press_keys("hjkl");
    await expect_grid("37s,40s,38s,39s,");
  });

  await run_case("x ends the mode and cuts behind the arrows", async () => {
    await open_grid("cut");
    await hook_clipboard();
    await press_keys("vllx");
    await expect_grid("39s,39s,cut,");
    await expect_badge("NORMAL");
    // Outside the mode, l is the plain Sheets arrow.
    await press_keys("l");
    await expect_grid("39s,39s,cut,39,");
  });

  await run_case("fast v l l x keeps the order, the cut after both arrows", async () => {
    await open_grid("fast");
    await hook_clipboard();
    await press_keys("vllx");
    await expect_grid("39s,39s,cut,");
  });

  await run_case("y copies the range and ends the mode", async () => {
    await open_grid("copy_in");
    await hook_clipboard();
    await press_keys("vly");
    await expect_grid("39s,copy,");
    await expect_badge("NORMAL");
  });

  await run_case("p pastes and ends the mode", async () => {
    await open_grid("paste");
    await hook_clipboard();
    await seed_clipboard("pasted");
    await press_keys("vp");
    await expect_grid("paste,");
    await expect_badge("NORMAL");
  });

  await run_case("Escape ends the mode with no collapse key, and the next l sends nothing", async () => {
    await open_grid("escape");
    await press_keys("vl");
    await press_keys("-k", "Escape");
    await expect_badge("NORMAL");
    await press_keys("l");
    await expect_grid("39s,39,");
  });

  await run_case("y outside the mode copies the cell", async () => {
    await open_grid("copy_out");
    await hook_clipboard();
    await press_keys("y");
    await expect_grid("copy,");
  });
}
