import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The .mjs modules carry no types, so they load through a dynamic import.
const { create_ledger, load_weights, pick_debug_ports, queue_order, stale_weight_warnings, weights_from_report, write_weights } = await import(join(import.meta.dirname, "shards.mjs"));

const with_dir = (body: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "shards-test-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("queue_order puts unknown pieces first, then the longest", () => {
  const order = queue_order(["p1_a.mjs", "p2_b.mjs", "p3_new.mjs", "p4_c.mjs"], { p1_a: 5, p2_b: 40, p4_c: 12 });
  assert.deepEqual(order, ["p3_new.mjs", "p2_b.mjs", "p4_c.mjs", "p1_a.mjs"]);
});

test("weights_from_report rounds to seconds and skips in-flight pieces", () => {
  const weights = weights_from_report({ pieces: [{ name: "p1_a.mjs", wall_ms: 12400 }, { name: "p2_b.mjs", wall_ms: 3000, in_flight: true }] });
  assert.deepEqual(weights, { p1_a: 12 });
});

test("load_weights takes a newer local timings file over the committed one, piece by piece", () => {
  with_dir((dir) => {
    const committed_path = join(dir, "piece_seconds.json");
    writeFileSync(committed_path, JSON.stringify({ p1_a: 5, p2_b: 7 }));
    const old = new Date(Date.now() - 60000);
    utimesSync(committed_path, old, old);
    assert.deepEqual(load_weights({ committed_path, logs_dir: join(dir, "no-logs") }).weights, { p1_a: 5, p2_b: 7 });
    writeFileSync(join(dir, "key-test-timings-x.json"), JSON.stringify({ pieces: [{ name: "p1_a.mjs", wall_ms: 30000 }] }));
    const loaded = load_weights({ committed_path, logs_dir: dir });
    assert.deepEqual(loaded.weights, { p1_a: 30, p2_b: 7 });
    assert.match(loaded.source, /key-test-timings-x\.json$/);
  });
});

test("load_weights ignores a local file older than the committed one", () => {
  with_dir((dir) => {
    const timings_path = join(dir, "key-test-timings-old.json");
    writeFileSync(timings_path, JSON.stringify({ pieces: [{ name: "p1_a.mjs", wall_ms: 30000 }] }));
    const old = new Date(Date.now() - 60000);
    utimesSync(timings_path, old, old);
    const committed_path = join(dir, "piece_seconds.json");
    writeFileSync(committed_path, JSON.stringify({ p1_a: 5 }));
    assert.deepEqual(load_weights({ committed_path, logs_dir: dir }).weights, { p1_a: 5 });
  });
});

test("the ledger names in-flight and unstarted pieces, and each shard's sequence", () => {
  const ledger = create_ledger(["a", "b", "c", "d"]);
  assert.equal(ledger.take(1, 0), "a");
  assert.equal(ledger.take(2, 0), "b");
  ledger.finish("a", 30);
  assert.equal(ledger.take(1, 30), "c");
  assert.deepEqual(ledger.in_flight(), ["b", "c"]);
  assert.equal(ledger.in_flight_of(1), "c");
  assert.equal(ledger.in_flight_of(3), undefined);
  assert.deepEqual(ledger.not_started(), ["d"]);
  assert.deepEqual(ledger.sequence_of(1), ["a", "c"]);
  assert.equal(ledger.busy_ms_of(1, 50), 50);
  ledger.finish("b", 10);
  ledger.finish("c", 40);
  assert.equal(ledger.take(2, 40), "d");
  assert.equal(ledger.take(1, 40), undefined);
});

test("stale_weight_warnings flags a piece over twice its weight or 10 s over it", () => {
  const warnings = stale_weight_warnings(
    [
      { name: "p1_a.mjs", wall_ms: 5000 },
      { name: "p2_b.mjs", wall_ms: 9000 },
      { name: "p3_c.mjs", wall_ms: 61000 },
      { name: "p4_d.mjs", wall_ms: 99000, in_flight: true },
    ],
    { p1_a: 4, p2_b: 4, p3_c: 50, p4_d: 1 },
  );
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /^p2_b /);
  assert.match(warnings[1], /^p3_c /);
});

test("write_weights refuses an incomplete run and keeps weights the file lacks", () => {
  with_dir((dir) => {
    const committed_path = join(dir, "piece_seconds.json");
    writeFileSync(committed_path, JSON.stringify({ p1_a: 5, p2_b: 7, p9_gone: 3 }));
    const incomplete_path = join(dir, "incomplete.json");
    writeFileSync(incomplete_path, JSON.stringify({ pieces: [{ name: "p1_a.mjs", wall_ms: 1000 }], incomplete: { reason: "deadline" } }));
    assert.throws(() => write_weights(incomplete_path, { committed_path, piece_names: ["p1_a", "p2_b"] }), /did not finish/);
    const full_path = join(dir, "full.json");
    writeFileSync(full_path, JSON.stringify({ pieces: [{ name: "p1_a.mjs", wall_ms: 20000 }, { name: "p3_new.mjs", wall_ms: 4000 }] }));
    const { merged } = write_weights(full_path, { committed_path, piece_names: ["p1_a", "p2_b", "p3_new"] });
    assert.deepEqual(merged, { p1_a: 20, p2_b: 7, p3_new: 4 });
  });
});

test("pick_debug_ports gives distinct free ports below the ephemeral range", async () => {
  const ports: number[] = await pick_debug_ports(8, { floor: 32768 });
  assert.equal(new Set(ports).size, 8);
  for (const port of ports) assert.ok(port >= 10000 && port < 32768, `port ${port}`);
});

test("pick_debug_ports skips a port that is taken", async () => {
  const held = net.createServer();
  await new Promise<void>((resolve) => held.listen(0, "127.0.0.1", resolve));
  const { port } = held.address() as net.AddressInfo;
  try {
    // A range of three ports that holds the taken one forces the probe past it.
    const ports: number[] = await pick_debug_ports(1, { floor: port + 2, lowest: port });
    assert.notEqual(ports[0], port);
  } finally {
    held.close();
  }
});
