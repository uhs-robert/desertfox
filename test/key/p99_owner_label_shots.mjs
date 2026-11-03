// Screenshots of the which-key panels for the root, s, ; and g groups, under a copy of the owner config.
// Runs only with OASISFOX_SHOT_DIR (where the shots go) and OASISFOX_OWNER_COPY (a copy of ~/.config/oasisfox with the symlinks resolved).
// It runs last in the piece order because it swaps the config. The test config is loaded again at the end.
import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const test_config_dir = join(dirname(fileURLToPath(import.meta.url)), "config");

export async function run_cases({ config_dir, load_config_dir, take_shot, run_case, send_keys, open_page, wait_event, events, sleep }) {
  const shot_dir = process.env.OASISFOX_SHOT_DIR;
  const owner_copy = process.env.OASISFOX_OWNER_COPY;
  if (!shot_dir || !owner_copy) return;

  // The owner config has no key for the manual panel, so the test one comes along.
  cpSync(join(test_config_dir, "keymap.d", "60-whichkey.toml"), join(owner_copy, "keymap.d", "60-whichkey.toml"));
  await open_page("page", "owner_labels", { new_tab: true });
  await load_config_dir(owner_copy);
  await open_page("page", "owner_labels_2", { new_tab: true });

  const panel_shot = async (name, keys) => {
    await run_case(`shot of the ${name} panel under the owner config`, async () => {
      const mark = events.length;
      await send_keys(...keys);
      await wait_event(mark, (event) => event.type === "whichkey" && event.page_id === "owner_labels_2" && event.value !== "", "the which-key panel");
      await sleep(300);
      await take_shot(`${shot_dir}/owner-${name}.png`);
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
