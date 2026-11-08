// Balancing for the sharded key test: piece weights, the order of the queue, the ledger of handed-out pieces and the debug ports.
// It holds no session, so its unit tests run without SHADOW_SH. `node test/key/shards.mjs write-weights [timings file]` rewrites piece_seconds.json.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const key_test_dir = dirname(fileURLToPath(import.meta.url));
export const COMMITTED_WEIGHTS_PATH = join(key_test_dir, "piece_seconds.json");

export const piece_name_of = (file) => basename(file).replace(/\.mjs$/, "");

// Seconds per piece name from a timings file, at least 1, so the stale-weight check does not flag a piece for a fraction of a second. An in-flight entry is cut short, so it says nothing about the piece's length.
export function weights_from_report(report) {
  const weights = {};
  for (const piece of report.pieces ?? []) {
    if (piece.in_flight) continue;
    const name = piece_name_of(piece.name);
    weights[name] = (weights[name] ?? 0) + Math.max(1, Math.round(piece.wall_ms / 1000));
  }
  return weights;
}

// The newest key-test-timings file in logs_dir that lists pieces and ran every case, or undefined.
export function newest_timings_file(logs_dir) {
  let names;
  try {
    names = readdirSync(logs_dir).filter((name) => /^key-test-timings-.*\.json$/.test(name));
  } catch {
    return undefined;
  }
  const by_age = names.map((name) => join(logs_dir, name)).map((path) => ({ path, mtime_ms: statSync(path).mtimeMs })).sort((left, right) => right.mtime_ms - left.mtime_ms);
  for (const { path, mtime_ms } of by_age) {
    try {
      const report = JSON.parse(readFileSync(path, "utf8"));
      // A KEY_TEST_ONLY run skips most cases, so its piece times are far too short to order a full run.
      if (Array.isArray(report.pieces) && report.pieces.length > 0 && !report.filter) return { path, mtime_ms, report };
    } catch {
      // A file cut off by a kill mid-write is skipped.
    }
  }
  return undefined;
}

// The committed weights, overridden piece by piece by a newer local timings file or by the file the caller names.
// A fresh worktree has no .logs, so the committed file is the base. The queue only needs the order, so a stale weight costs little.
export function load_weights({ committed_path = COMMITTED_WEIGHTS_PATH, logs_dir, chosen_file } = {}) {
  const committed = JSON.parse(readFileSync(committed_path, "utf8"));
  if (chosen_file) {
    return { weights: { ...committed, ...weights_from_report(JSON.parse(readFileSync(chosen_file, "utf8"))) }, source: chosen_file };
  }
  const local = logs_dir ? newest_timings_file(logs_dir) : undefined;
  if (local && local.mtime_ms > statSync(committed_path).mtimeMs) {
    return { weights: { ...committed, ...weights_from_report(local.report) }, source: local.path };
  }
  return { weights: committed, source: committed_path };
}

// Longest first, so the long pieces start early and the short ones fill the gaps at the end.
// A piece with no weight goes first: a new piece of unknown length placed last can stretch the run by its whole length.
export function queue_order(piece_files, weights) {
  const weight_of = (file) => weights[piece_name_of(file)] ?? Number.POSITIVE_INFINITY;
  return [...piece_files].sort((left, right) => weight_of(right) - weight_of(left) || left.localeCompare(right));
}

// The coordinator's record of which shard holds which piece. A worker killed with SIGKILL writes nothing, so this is what names the in-flight pieces of a dead run.
export function create_ledger(queue) {
  const waiting = [...queue];
  const entries = new Map();
  return {
    take(shard, at_ms) {
      const piece = waiting.shift();
      if (piece !== undefined) entries.set(piece, { piece, shard, handed_at_ms: at_ms, done_at_ms: undefined });
      return piece;
    },
    finish(piece, at_ms) {
      const entry = entries.get(piece);
      if (entry) entry.done_at_ms = at_ms;
    },
    in_flight: () => [...entries.values()].filter((entry) => entry.done_at_ms === undefined).map((entry) => entry.piece),
    in_flight_of: (shard) => [...entries.values()].find((entry) => entry.shard === shard && entry.done_at_ms === undefined)?.piece,
    not_started: () => [...waiting],
    sequence_of: (shard) => [...entries.values()].filter((entry) => entry.shard === shard).map((entry) => entry.piece),
    busy_ms_of: (shard, now_ms) => [...entries.values()].filter((entry) => entry.shard === shard).reduce((sum, entry) => sum + (entry.done_at_ms ?? now_ms) - entry.handed_at_ms, 0),
  };
}

// A piece that ran more than twice its weight, or more than 10 s over it, has a stale weight or was slowed by load.
export function stale_weight_warnings(pieces, weights) {
  const warnings = [];
  for (const piece of pieces) {
    if (piece.in_flight) continue;
    const weight = weights[piece_name_of(piece.name)];
    if (weight === undefined) continue;
    const seconds = piece.wall_ms / 1000;
    if (seconds > weight * 2 || seconds > weight + 10) warnings.push(`${piece_name_of(piece.name)} ran ${seconds.toFixed(1)} s against a weight of ${weight} s`);
  }
  return warnings;
}

// The low end of the kernel's ephemeral range. A port bound to 0 (each page server, each outgoing connection) comes from that range, so a debug port below it never meets one.
function ephemeral_port_floor() {
  try {
    return Number(readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim().split(/\s+/)[0]);
  } catch {
    return 32768;
  }
}

const port_is_free = (port) => new Promise((resolve_free) => {
  const probe = net.createServer();
  probe.once("error", () => resolve_free(false));
  probe.listen(port, "127.0.0.1", () => probe.close(() => resolve_free(true)));
});

// Distinct free ports for the workers' debuggers, one probe at a time. Each worker probing for its own free port can draw the same number as another worker, in the gap before its Firefox binds it.
export async function pick_debug_ports(count, { floor = ephemeral_port_floor(), lowest = 10000 } = {}) {
  const span = floor - lowest - count;
  if (span <= 0) throw new Error(`no room for ${count} debug ports below the ephemeral range at ${floor}`);
  // A random start, so a port another tool holds open is skipped once and not met on every run.
  const start = lowest + Math.floor(Math.random() * span);
  const ports = [];
  for (let port = start; ports.length < count && port < floor; port++) {
    if (await port_is_free(port)) ports.push(port);
  }
  if (ports.length < count) throw new Error(`found ${ports.length} of ${count} free debug ports between ${start} and ${floor}`);
  return ports;
}

// Rewrites the committed weights from a timings file. Pieces the file lacks keep their weight, and pieces that no longer exist are dropped.
export function write_weights(timings_path, { committed_path = COMMITTED_WEIGHTS_PATH, piece_names }) {
  const report = JSON.parse(readFileSync(timings_path, "utf8"));
  if (report.incomplete) throw new Error(`${timings_path} is from a run that did not finish (${report.incomplete.reason}), so its pieces are cut short`);
  if (report.filter) throw new Error(`${timings_path} is from a run filtered by KEY_TEST_ONLY=${report.filter}, so its pieces skipped cases`);
  const fresh = weights_from_report(report);
  if (Object.keys(fresh).length === 0) throw new Error(`${timings_path} lists no finished piece`);
  const old = JSON.parse(readFileSync(committed_path, "utf8"));
  const merged = Object.fromEntries(piece_names.sort().map((name) => [name, fresh[name] ?? old[name]]).filter(([, seconds]) => seconds !== undefined));
  writeFileSync(committed_path, `${JSON.stringify(merged, null, 2)}\n`);
  return { merged, updated: Object.keys(fresh).filter((name) => piece_names.includes(name)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [verb, given_file] = process.argv.slice(2);
  if (verb !== "write-weights") {
    console.error("usage: node test/key/shards.mjs write-weights [timings file]");
    process.exit(2);
  }
  const timings_path = given_file ?? newest_timings_file(join(key_test_dir, "../../.logs"))?.path;
  if (!timings_path) {
    console.error("key-test-weights: no .logs/key-test-timings-*.json in this checkout. Run a full `just key-test` first, or name a file.");
    process.exit(2);
  }
  const piece_names = readdirSync(key_test_dir).filter((name) => /^p\d+_.*\.mjs$/.test(name)).map(piece_name_of);
  const { updated } = write_weights(timings_path, { piece_names });
  console.log(`piece_seconds.json: ${updated.length} of ${piece_names.length} pieces updated from ${timings_path}`);
}
