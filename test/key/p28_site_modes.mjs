// Site modes: a site row's `modes.<name>` is a set of binds laid over normal mode, started by `mode.site <name>`. The shipped rows have no mode, so this piece adds a test-only row for the /grid stand-in, whose editor records each arrow keydown it gets, with an s when Shift was held.
// In the mode, l and h send shifted arrows. Every exit of the fixed policy must leave the next l as a plain normal mode key, which sends nothing.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "config", "ui"];

const arrow = (key, key_code, shift) => `{ id = "page.send_key", args = { key = "${key}", key_code = ${key_code}, ${shift ? "shift = true, " : ""}target = "#waffle-rich-text-editor" } }`;
const ROW = [
  "",
  "[[site_rules]]",
  'site = "*://127.0.0.1/*?id=grid_*"',
  'bind = { v = "mode.site visual", V = "mode.site visual" }',
  `modes.visual = { label = "VISUAL", bind = { l = ${arrow("ArrowRight", 39, true)}, h = ${arrow("ArrowLeft", 37, true)}, x = [{ id = "mode.site", args = { name = "off" } }, ${arrow("ArrowDown", 40, false)}] } }`,
  "",
].join("\n");

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, poll_until, expect, sleep }) {
  let config_dir;
  await setup("load a config with a visual mode row for the grid_ pages", async () => {
    config_dir = config_copy();
    appendFileSync(join(config_dir, "settings.toml"), ROW);
    await load_config_dir(config_dir);
  });

  const badge = () => in_active_tab(`document.querySelector("[data-desertfox-mode]")?.getAttribute("data-desertfox-mode") ?? null`);
  const grid = () => in_active_tab("document.documentElement.dataset.grid");
  async function expect_badge(label) {
    let seen;
    await poll_until(`the ${label} badge`, async () => (seen = await badge()) === label, { timeout_ms: 3000, expected_timeout: true }).catch(() => expect(false, `the badge is ${seen}, expected ${label}`));
  }
  async function expect_grid(wanted) {
    await poll_until(`arrow codes ${wanted}`, async () => (await grid()) === wanted, { timeout_ms: 3000, expected_timeout: true }).catch(async () => expect(false, `the grid saw "${await grid()}", expected "${wanted}"`));
    // A plain key must not also act again later.
    await sleep(200);
    expect((await grid()) === wanted, `the grid changed to ${await grid()}`);
  }
  // An l after the mode ended is a normal mode key: it sends nothing to the grid.
  async function expect_mode_ended(before) {
    await expect_badge("NORMAL");
    await press_keys("l");
    await expect_grid(before);
  }
  const open_grid = (id) => open_page("grid", `grid_${id}`, { new_tab: true });

  await run_case("v starts the mode with its label, and l sends a shifted arrow each time", async () => {
    await open_grid("keys");
    await press_keys("v");
    await expect_badge("VISUAL");
    await press_keys("l");
    await press_keys("l");
    await expect_grid("39s,39s,");
  });

  await run_case("keys typed at once, v and the l behind it, run in order under the mode", async () => {
    await open_grid("fast");
    await press_keys("vllh");
    await expect_grid("39s,39s,37s,");
  });

  await run_case("V starts the same mode, and a count repeats the shifted arrow", async () => {
    await open_grid("count");
    await press_keys("V3l");
    await expect_grid("39s,39s,39s,");
  });

  await run_case("Escape ends the mode only", async () => {
    await open_grid("escape");
    await press_keys("vl");
    await expect_grid("39s,");
    await press_keys("-k", "Escape");
    await expect_mode_ended("39s,");
  });

  await run_case("a bind that ends the mode and then sends a key leaves normal mode behind it", async () => {
    await open_grid("chain");
    await press_keys("vlx");
    await expect_grid("39s,40,");
    await expect_mode_ended("39s,40,");
  });

  await run_case("a key DesertFox does not cancel ends the mode", async () => {
    await open_grid("passed");
    await press_keys("vl");
    await press_keys("-k", "F9");
    await expect_mode_ended("39s,");
  });

  await run_case("a mouse press ends the mode, and one with no mode on does nothing", async () => {
    await open_grid("mouse");
    await in_active_tab(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0`);
    await expect_badge("NORMAL");
    await press_keys("vl");
    await expect_grid("39s,");
    await in_active_tab(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); 0`);
    await expect_mode_ended("39s,");
  });

  await run_case("focus moving into an editable ends the mode", async () => {
    await open_grid("focus");
    await press_keys("v");
    await expect_badge("VISUAL");
    // The edit starts with no key, so the next key's re-check is what moves the mode to insert.
    await in_active_tab(`document.getElementById("cell").dispatchEvent(new MouseEvent("dblclick")); 0`);
    await press_keys("l");
    await expect_badge("INSERT");
    await in_active_tab(`document.getElementById("cell").dispatchEvent(new MouseEvent("click")); 0`);
    await press_keys("-k", "F9");
    await expect_badge("NORMAL");
    await press_keys("l");
    await expect_grid("");
  });

  await run_case("a keymap update ends the mode", async () => {
    await open_grid("reload");
    await press_keys("vl");
    await expect_grid("39s,");
    await load_config_dir(config_dir);
    await expect_mode_ended("39s,");
  });

  await run_case("the macro stop key works inside the mode, and the recorded steps replay", async () => {
    await open_grid("macro");
    await press_keys("qa");
    await expect_badge("NORMAL recording @a");
    await press_keys("vlq");
    await expect_grid("39s,");
    // Stopping the recording changes the keymap reply, which is a keymap update, so it ends the mode with the recording.
    await expect_badge("NORMAL");
    await press_keys("@a");
    await expect_grid("39s,39s,");
    await expect_badge("VISUAL");
  });
}
