// Key test case for the command line frame background. The list grows from one row to many in one key, and the frame
// must not show its own white canvas in the new strip. A burst of shots over the first 130 ms goes to OASISFOX_SHOT_DIR when set.
const CTRL = (key) => ["-M", "ctrl", key, "-m", "ctrl"];

export async function run_cases({ run_case, send_keys, open_page, take_shot, sleep }) {
  const shot_dir = process.env.OASISFOX_SHOT_DIR;
  if (!shot_dir) return;
  await open_page("page", "p9_flash", { new_tab: true });

  await run_case("screenshots while the command line list grows from one row to many", async () => {
    await send_keys(":");
    await sleep(900);
    await send_keys("tab.close");
    await sleep(500);
    const shots = [0, 8, 16, 24, 33, 41, 50, 60, 70, 85, 100, 130].map((delay) => sleep(delay).then(() => take_shot(`${shot_dir}/grow-${String(delay).padStart(2, "0")}ms.png`)));
    await Promise.all([send_keys(...CTRL("u")), ...shots]);
    await sleep(300);
    await send_keys("-k", "Escape");
    await sleep(400);
    await send_keys("-k", "Escape");
    await sleep(400);
  });
}
