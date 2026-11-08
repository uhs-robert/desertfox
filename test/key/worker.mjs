// One shard of the key test, forked by run.mjs. It owns one session (nested compositor, Firefox, profile, page server)
// and runs the pieces the coordinator hands it, one at a time, until it is told to stop.
// The coordinator passes KEY_TEST_DEBUG_PORT, KEY_TEST_STARTUP_DELAY_MS, KEY_TEST_DIAGNOSTICS_DIR and this shard's KEY_TEST_TIMINGS_FILE.
import { create_session } from "./harness.mjs";
import { create_timings } from "./timings.mjs";

// shadow.sh caps names at 8 characters. "ok" plus a base-36 pid is at most 8 and unique among live workers.
const shadow_name = `ok${process.pid.toString(36)}`;
const startup_delay_ms = Number(process.env.KEY_TEST_STARTUP_DELAY_MS ?? 0);

// Resolves once the message is out, so a worker that exits right after still delivers it.
const send = (message) => new Promise((resolve) => {
  if (process.connected) process.send(message, () => resolve());
  else resolve();
});

let session;
let closing;
function close_and_exit(code) {
  closing ??= (async () => {
    if (session) {
      await session.sample_tabs("after pieces").catch(() => undefined);
      await session.close().catch((error) => console.error(`session close failed: ${error.message}`));
    }
    process.exit(code);
  })();
  return closing;
}

// The harness tears the session down on a signal while the running piece goes on. That piece did not finish, so it is not reported done, and the coordinator lists it as in flight.
let signalled = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { signalled = true; });

// The coordinator died or dropped this worker. No session outlives its coordinator.
process.on("disconnect", () => close_and_exit(1));

process.on("message", async (message) => {
  if (message.type === "stop") {
    await close_and_exit(0);
    return;
  }
  if (message.type !== "run") return;
  const { piece_file } = message;
  const results_before = session.results.length;
  try {
    await session.run_piece(piece_file, await import(`./${piece_file}`));
  } catch (error) {
    session.results.push({ name: `${piece_file} worker`, pass: false, reason: error.message, setup: false });
    console.log(`FAIL ${piece_file} worker: ${error.message}`);
  }
  if (signalled) return;
  await send({ type: "piece_done", piece_file, results: session.results.slice(results_before), firefox_lost: session.firefox_lost() });
});

if (shadow_name.length > 8) throw new Error(`shadow name ${shadow_name} is longer than 8 characters`);
await new Promise((resolve) => setTimeout(resolve, startup_delay_ms));
try {
  session = await create_session({
    name: shadow_name,
    timings: create_timings(),
    sweep: false,
    debug_port: Number(process.env.KEY_TEST_DEBUG_PORT),
    diagnostics_dir: process.env.KEY_TEST_DIAGNOSTICS_DIR,
    print_summary: false,
  });
} catch (error) {
  // create_session tore its own session down before it threw.
  await send({ type: "startup_failed", reason: error.message });
  process.exit(1);
}
await session.sample_tabs("before pieces");
await send({ type: "ready", name: shadow_name });
