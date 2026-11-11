// A site row binds x and p to `page.clipboard`, and passes <C-v> to the page. The shipped Sheets rows match docs.google.com only, so this piece uses a row of its own on the /clipboard page, which records each cut, copy and paste event with whether the browser sent it.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

export const areas = ["keys", "config", "bundles"];

const clip = (action) => `{ id = "page.clipboard", args = { action = "${action}", target = "#waffle-rich-text-editor" } }`;

export async function run_cases({ config_copy, load_config_dir, setup, run_case, open_page, press_keys, in_active_tab, in_background, poll_until, expect, sleep }) {
  await setup("load a config with a clipboard row", async () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), ["", "[[site_rules]]", 'site = "*://127.0.0.1/*?id=clip_*"', `bind = { x = ${clip("cut")}, p = ${clip("paste")}, y = ${clip("copy")} }`, 'pass = "<C-v>"', ""].join("\n"));
    await load_config_dir(dir);
  });

  const seed_clipboard = (text) => in_background(`navigator.clipboard.writeText(${JSON.stringify(text)}).then(() => true)`);
  const events_seen = () => in_active_tab("document.documentElement.dataset.clip");
  const expect_events = async (wanted) => {
    await poll_until(`clipboard events ${wanted}`, async () => (await events_seen()) === wanted);
    await sleep(200);
    expect((await events_seen()) === wanted, `the events changed to ${await events_seen()}`);
  };

  await run_case("x fires a trusted cut event on the editor", async () => {
    await open_page("clipboard", "clip_cut", { new_tab: true });
    await press_keys("x");
    await expect_events("cut:true:,");
  });

  await run_case("y fires a trusted copy event on the editor", async () => {
    await open_page("clipboard", "clip_copy", { new_tab: true });
    await press_keys("y");
    await expect_events("copy:true:,");
  });

  await run_case("p fires a trusted paste event that carries the clipboard text", async () => {
    await open_page("clipboard", "clip_paste", { new_tab: true });
    await seed_clipboard("from the clipboard");
    await press_keys("p");
    await expect_events("paste:true:from the clipboard,");
  });

  await run_case("a real Ctrl+V reaches the page when the row passes it", async () => {
    await open_page("clipboard", "clip_real", { new_tab: true });
    await seed_clipboard("real paste");
    await press_keys("-M", "ctrl", "-k", "v", "-m", "ctrl");
    await expect_events("paste:true:real paste,");
  });
}
