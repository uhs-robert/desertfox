// The README demo: plays the scenes of demo_scenes.mjs in a key-test session, then turns the film into a looping GIF.
// Run through `just readme-demo`. The stills and the GIF land in docs/images, or in DEMO_OUT_DIR.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { create_session } from "./harness.mjs";
import * as scenes from "./demo_scenes.mjs";
import { create_timings } from "./timings.mjs";

const GIF_MAX_BYTES = 5 * 1024 * 1024;
// Tried in order. The frame rate falls before the width, and the first that fits the cap wins.
const GIF_SETTINGS = [{ fps: 12, width: 960 }, { fps: 10, width: 960 }, { fps: 8, width: 960 }, { fps: 10, width: 800 }, { fps: 8, width: 800 }, { fps: 8, width: 640 }];

// A palette pass keeps the 256 colors for this clip, and the loop count 0 is forever.
function make_gif(film_path, film_seconds, gif_path) {
  for (const { fps, width } of GIF_SETTINGS) {
    const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    const result = spawnSync("ffmpeg", ["-y", "-v", "error", "-t", String(film_seconds), "-i", film_path, "-filter_complex", filter, "-loop", "0", gif_path], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("ffmpeg failed");
    const bytes = statSync(gif_path).size;
    console.log(`gif ${width} px at ${fps} fps: ${bytes} bytes`);
    if (bytes <= GIF_MAX_BYTES) return;
  }
  throw new Error(`no setting fits the ${GIF_MAX_BYTES} byte cap`);
}

async function main() {
  const session = await create_session({ name: `demo${process.pid.toString(36)}`, timings: create_timings(), print_summary: false });
  let failed = false;
  try {
    await session.run_piece("demo_scenes.mjs", scenes);
    failed = session.results.some((result) => !result.pass);
  } finally {
    await session.close();
  }
  if (failed) process.exit(1);
  const work_dir = join(scenes.output_dir, scenes.WORK_DIR_NAME);
  make_gif(join(work_dir, "film.mkv"), Number(readFileSync(join(work_dir, "film_seconds"), "utf8")), join(scenes.output_dir, "demo.gif"));
  rmSync(work_dir, { recursive: true, force: true });
}

await main();
