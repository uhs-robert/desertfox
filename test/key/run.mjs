// The key test: real key presses in a nested session, results read from pages that report to a local server.
// harness.mjs holds the session and the helpers. This file holds the order of the run and the summary.
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { create_session, shadow_down } from "./harness.mjs";
import { create_timings } from "./timings.mjs";

const key_test_dir = dirname(fileURLToPath(import.meta.url));
// KEY_TEST_PIECES=p7_caret,p11_find runs only those pieces. KEY_TEST_ORDER=reverse runs them last to first.
function chosen_piece_files() {
  const all = readdirSync(key_test_dir).filter((name) => /^p\d+_.*\.mjs$/.test(name)).sort();
  const wanted = (process.env.KEY_TEST_PIECES ?? "").split(",").map((name) => name.trim().replace(/\.mjs$/, "")).filter(Boolean);
  const unknown = wanted.filter((name) => !all.includes(`${name}.mjs`));
  if (unknown.length > 0) throw new Error(`KEY_TEST_PIECES names no piece: ${unknown.join(", ")}`);
  const files = wanted.length === 0 ? all : all.filter((file) => wanted.includes(file.replace(/\.mjs$/, "")));
  if (process.env.KEY_TEST_ORDER === "reverse") files.reverse();
  else if (process.env.KEY_TEST_ORDER) throw new Error(`KEY_TEST_ORDER must be "reverse" or unset, got ${process.env.KEY_TEST_ORDER}`);
  return files;
}

// shadow.sh caps names at 8 characters. "ok" plus a base-36 pid is at most 8 and unique among live runs.
const SHADOW_NAME = `ok${process.pid.toString(36)}`;
if (SHADOW_NAME.length > 8) throw new Error(`shadow name ${SHADOW_NAME} is longer than 8 characters`);

async function main() {
  const piece_files = chosen_piece_files();
  const timings = create_timings();
  const session = await create_session({ name: SHADOW_NAME, timings });
  const { results } = session;

  try {
    await session.sample_tabs("before pieces");
    for (const file of piece_files) {
      await session.run_piece(file, await import(`./${file}`));
    }
    await session.sample_tabs("after pieces");
  } finally {
    await session.close();
  }

  const failed = results.filter((result) => !result.pass);
  const setup_ran = results.filter((result) => result.setup).length;
  if (setup_ran > 0) console.log(`${setup_ran} setup cases ran only because KEY_TEST_ONLY filtered the run`);
  console.log(`${results.length - failed.length} of ${results.length} cases passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(`key-test aborted: ${error.stack}`);
  await shadow_down(SHADOW_NAME).catch(() => undefined);
  process.exit(1);
});
