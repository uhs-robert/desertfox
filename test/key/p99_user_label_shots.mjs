// Screenshots of the which-key panels for the root, s, ; and g groups, under a copy of the user config.
// Runs only with DESERTFOX_SHOT_DIR (where the shots go) and DESERTFOX_USER_COPY (a copy of ~/.config/desertfox with the symlinks resolved).
// It runs last in the piece order because it swaps the config. The test config is loaded again at the end.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const test_config_dir = join(dirname(fileURLToPath(import.meta.url)), "config");

export async function run_cases({ config_dir, load_config_dir, take_shot, run_case, send_keys, open_page, wait_event, events, sleep }) {
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  const user_copy = process.env.DESERTFOX_USER_COPY;
  if (!shot_dir || !user_copy) return;

  // The user config has no key for the manual panel, so the test one comes along.
  mkdirSync(join(user_copy, "keymap.d"), { recursive: true });
  cpSync(join(test_config_dir, "keymap.d", "60-whichkey.toml"), join(user_copy, "keymap.d", "60-whichkey.toml"));
  await open_page("page", "user_labels", { new_tab: true });
  await load_config_dir(user_copy);
  await open_page("page", "user_labels_2", { new_tab: true });

  const panel_shot = async (name, keys) => {
    await run_case(`shot of the ${name} panel under the user config`, async () => {
      const mark = events.length;
      await send_keys(...keys);
      await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "user_labels_2" && event.value !== "", "the which-key panel");
      await sleep(300);
      await take_shot(`${shot_dir}/user-${name}.png`);
      await send_keys("-k", "Escape");
      await sleep(300);
    });
  };
  await panel_shot("root", [",w"]);
  await panel_shot("s", ["s"]);
  await panel_shot("hints", [";"]);
  await panel_shot("g", ["g"]);

  await load_config_dir(config_dir);
}
