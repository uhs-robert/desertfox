// Site mode binds: a site row's `keymap.<mode>` binds keys in caret and visual mode for the pages it matches. The row binds x to `mode insert`, so the INSERT badge shows that the bound key ran. A page the row does not match leaves x unbound in both modes, and which-key lists x in visual mode only on the matching page.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "config", "caret", "whichkey"];

const ROW = [
  "",
  "[[site_rules]]",
  'site = "*://127.0.0.1/*?id=smb_hit*"',
  "[site_rules.keymap.visual]",
  'x = "mode insert"',
  "[site_rules.keymap.caret]",
  'x = "mode insert"',
  "",
].join("\n");

// The chord that lists the keys of the current mode.
const CHORD = ["-M", "alt", "-M", "shift", "/", "-m", "shift", "-m", "alt"];

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, poll_until, wait_event, events, expect, sleep, badge_is, escape_to_normal }) {
  await setup("load a config with keymap.visual and keymap.caret binds for the smb_hit pages", async () => {
    const config_dir = config_copy();
    appendFileSync(join(config_dir, "settings.toml"), ROW);
    await load_config_dir(config_dir);
  });

  const badge_of = (page_id) => events.filter((event) => event.type === "indicator" && event.page_id === page_id).at(-1)?.label;
  async function enter(page_id, key, label) {
    await press_keys(key);
    await poll_until(`the ${label} badge`, async () => badge_of(page_id) === label);
  }
  async function leave_insert_and_mode(page_id) {
    await press_keys("-k", "Escape");
    await poll_until("the NORMAL badge", async () => {
      if (badge_of(page_id) !== "NORMAL") await press_keys("-k", "Escape");
      return badge_of(page_id) === "NORMAL";
    });
  }
  const panel_rows = async (page_id) => {
    const mark = events.length;
    await press_keys(...CHORD);
    const shown = await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === page_id && event.value !== "", "the which-key panel");
    const rows = Number(shown.value.split(":")[1]);
    await press_keys("-k", "Escape");
    await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === page_id && event.value === "", "the panel to close");
    return rows;
  };

  // Escape closes the panel and also steps visual mode back to caret mode, so each case reads the panel last and presses x in a visual mode of its own.
  const x_in_visual = async (page_id) => {
    await enter(page_id, "V", "VISUAL");
    await press_keys("x");
  };
  let hit_rows;
  await run_case("a visual mode bind of a matching page runs, and which-key lists it", async () => {
    await open_page("caret", "smb_hit_visual", { new_tab: true });
    await x_in_visual("smb_hit_visual");
    await poll_until("the INSERT badge after x in visual mode", async () => badge_of("smb_hit_visual") === "INSERT");
    await leave_insert_and_mode("smb_hit_visual");
    await enter("smb_hit_visual", "V", "VISUAL");
    hit_rows = await panel_rows("smb_hit_visual");
    await escape_to_normal("smb_hit_visual");
  });

  await run_case("a visual mode key of a page the row does not match is unbound, and which-key lists one row fewer", async () => {
    await open_page("caret", "smb_miss_visual", { new_tab: true });
    await x_in_visual("smb_miss_visual");
    await sleep(400);
    expect(badge_of("smb_miss_visual") === "VISUAL", `x changed the badge to ${badge_of("smb_miss_visual")}`);
    const miss_rows = await panel_rows("smb_miss_visual");
    expect(hit_rows === miss_rows + 1, `which-key listed ${hit_rows} rows on the matching page and ${miss_rows} on the other, expected one more`);
    await escape_to_normal("smb_miss_visual");
  });

  await run_case("a caret mode bind of a matching page runs, and the same key on another page does nothing", async () => {
    await open_page("caret", "smb_hit_caret", { new_tab: true });
    await enter("smb_hit_caret", "v", "CARET");
    await press_keys("x");
    await poll_until("the INSERT badge after x in caret mode", async () => badge_of("smb_hit_caret") === "INSERT");
    await leave_insert_and_mode("smb_hit_caret");
    await open_page("caret", "smb_miss_caret", { new_tab: true });
    await enter("smb_miss_caret", "v", "CARET");
    await press_keys("x");
    await sleep(400);
    expect(badge_of("smb_miss_caret") === "CARET", `x changed the badge to ${badge_of("smb_miss_caret")}`);
    await escape_to_normal("smb_miss_caret");
  });
}
