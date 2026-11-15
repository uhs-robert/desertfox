// The README demo: plays the scenes of demo_scenes.mjs in a key-test session, burns the key overlay into the film and turns it into a looping GIF.
// Run through `just readme-demo`. The stills and the GIF land in docs/images, or in DEMO_OUT_DIR, and only after the whole run worked.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { create_session } from "./harness.mjs";
import * as scenes from "./demo_scenes.mjs";
import { create_timings } from "./timings.mjs";

const repo_dir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const output_dir = process.env.DEMO_OUT_DIR ?? join(repo_dir, "docs", "images");
const STILL_NAMES = ["hints", "which-key", "command-line", "theme-switch"];
const STILL_SIZE = "1280x800";

const GIF_MAX_BYTES = 5 * 1024 * 1024;
// Tried in order. The frame rate falls before the width, and the first that fits the cap wins.
const GIF_SETTINGS = [{ fps: 12, width: 960 }, { fps: 10, width: 960 }, { fps: 8, width: 960 }, { fps: 10, width: 800 }, { fps: 8, width: 800 }, { fps: 8, width: 640 }];
// A press stays on screen this long, or until the next press, and the overlay shows the last few presses together.
const OVERLAY_HOLD_S = 1.2;
const OVERLAY_KEYS_SHOWN = 5;

function run_tool(tool, args) {
  const result = spawnSync(tool, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${tool} failed: ${result.stderr}`);
  return result.stdout;
}

// One drawtext per press, in the top right corner under the toolbar. The text goes through a file so no key needs escaping.
function overlay_filter(key_presses, stage_dir) {
  const stops = key_presses.map((press, index) => Math.min(key_presses[index + 1]?.at_s ?? Infinity, press.at_s + OVERLAY_HOLD_S));
  return key_presses.map((press, index) => {
    const recent = key_presses.slice(0, index + 1).filter((earlier) => press.at_s - earlier.at_s <= OVERLAY_HOLD_S).slice(-OVERLAY_KEYS_SHOWN);
    const text_path = join(stage_dir, `overlay_${index}.txt`);
    writeFileSync(text_path, recent.map((earlier) => earlier.label).join(" "));
    return `drawtext=textfile=${text_path}:expansion=none:fontfile=${process.env.DEMO_FONT ?? "/usr/share/fonts/TTF/DejaVuSansMono.ttf"}:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=10:x=w-tw-28:y=104:enable='between(t,${press.at_s.toFixed(2)},${stops[index].toFixed(2)})'`;
  }).join(",");
}

// A palette pass keeps the colors for this clip, and the loop count 0 is forever.
function make_gif(film_path, gif_path) {
  for (const { fps, width } of GIF_SETTINGS) {
    const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    run_tool("ffmpeg", ["-y", "-v", "error", "-i", film_path, "-filter_complex", filter, "-loop", "0", gif_path]);
    const bytes = statSync(gif_path).size;
    console.log(`gif ${width} px at ${fps} fps: ${bytes} bytes`);
    if (bytes <= GIF_MAX_BYTES) return;
  }
  throw new Error(`no setting fits the ${GIF_MAX_BYTES} byte cap`);
}

// A wrong region (the window not floated) gives the wrong size, so the stills are checked before they are kept.
function check_still_size(path) {
  const size = run_tool("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", path]).trim();
  if (size !== STILL_SIZE) throw new Error(`${path} is ${size}, not ${STILL_SIZE}`);
}

// The film is cut at film_seconds, so a film that is shorter than that is a recorder that stopped early.
const FILM_LENGTH_SLACK_S = 2;
function check_film_length(film_path, film_seconds) {
  const length_s = Number(run_tool("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", film_path]).trim());
  if (!(length_s >= film_seconds - FILM_LENGTH_SLACK_S)) throw new Error(`the film is ${length_s} s long, short of the ${film_seconds.toFixed(1)} s played`);
}

async function main() {
  const session = await create_session({ name: `demo${process.pid.toString(36)}`, timings: create_timings(), print_summary: false });
  try {
    scenes.set_stage_dir(mkdtempSync(join(tmpdir(), "desertfox-demo-")));
    try {
      await session.run_piece("demo_scenes.mjs", scenes);
    } finally {
      await session.close();
    }
    if (session.results.some((result) => !result.pass)) {
      process.exitCode = 1;
      return;
    }
    const { film_seconds, key_presses } = JSON.parse(readFileSync(join(scenes.stage_dir, "film.json"), "utf8"));
    check_film_length(join(scenes.stage_dir, "film.mkv"), film_seconds);
    const burned_path = join(scenes.stage_dir, "film_with_keys.mkv");
    run_tool("ffmpeg", ["-y", "-v", "error", "-t", String(film_seconds), "-i", join(scenes.stage_dir, "film.mkv"), "-vf", overlay_filter(key_presses, scenes.stage_dir), "-c:v", "libx264", "-crf", "14", "-preset", "ultrafast", burned_path]);
    make_gif(burned_path, join(scenes.stage_dir, "demo.gif"));
    for (const name of STILL_NAMES) check_still_size(join(scenes.stage_dir, `${name}.png`));
    mkdirSync(output_dir, { recursive: true });
    for (const file of [...STILL_NAMES.map((name) => `${name}.png`), "demo.gif"]) copyFileSync(join(scenes.stage_dir, file), join(output_dir, file));
  } finally {
    rmSync(scenes.stage_dir, { recursive: true, force: true });
  }
}

await main();
