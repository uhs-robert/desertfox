import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { create_native_client, NativeHostError } from "../../src/background/native_client.ts";

function watched_client(reply: () => Promise<unknown>, note: () => string | undefined) {
  const seen: unknown[] = [];
  const sent: object[] = [];
  const client = create_native_client(
    {
      has_permission: async () => true,
      send: async (message) => {
        sent.push(message);
        return reply();
      },
    },
    { seen: (release_version) => void seen.push(release_version), outdated_note: note },
  );
  return { client, seen, sent };
}

test("every reply of a watched call reports its release_version, ok or error", async () => {
  const ok = watched_client(async () => ({ ok: true, release_version: "0.1.22", files: {} }), () => undefined);
  await ok.client.read_config();
  assert.deepEqual(ok.seen, ["0.1.22"]);
  const refused = watched_client(async () => ({ ok: false, release_version: "0.1.22", error: "no" }), () => undefined);
  await assert.rejects(refused.client.write_autoconfig("a = 1\n"), NativeHostError);
  assert.deepEqual(refused.seen, ["0.1.22"]);
  const old_host = watched_client(async () => ({ ok: true, files: {} }), () => undefined);
  await old_host.client.read_config();
  assert.deepEqual(old_host.seen, [undefined]);
});

test("an error from an older host is host_outdated and says what the updater is doing", async () => {
  for (const note of ["updating", "update failed: offline"]) {
    const { client } = watched_client(async () => ({ ok: false, error: "unknown cmd" }), () => note);
    await assert.rejects(
      client.write_autoconfig(""),
      (error: unknown) => error instanceof NativeHostError && error.failure === "host_outdated" && error.message.includes(`(${note})`) && error.message.includes("unknown cmd"),
    );
  }
});

test("an ok reply from an older host stays ok", async () => {
  const { client } = watched_client(async () => ({ ok: true, files: {} }), () => "updating");
  assert.deepEqual((await client.read_config()).files, {});
});

test("self_update sends the version and hashes and nothing else, and its reply is not watched", async () => {
  const { client, seen, sent } = watched_client(async () => ({ ok: true, release_version: "0.1.22", updated: true, version: "0.1.23", replaced: [] }), () => "updating");
  const sha256 = { "desertfox-host": "a".repeat(64), "desertfox-bridge": "b".repeat(64), desertfox: "c".repeat(64) };
  assert.deepEqual(await client.self_update({ version: "0.1.23", sha256 }), { updated: true, version: "0.1.23" });
  assert.deepEqual(sent, [{ cmd: "self_update", version: "0.1.23", sha256 }]);
  assert.deepEqual(seen, []);
});

test("a refused self_update keeps the host's reason and is not labelled outdated", async () => {
  const { client } = watched_client(async () => ({ ok: false, error: "update running: another DesertFox host is updating now" }), () => "updating");
  await assert.rejects(client.self_update({ version: "0.1.23", sha256: {} }), (error: unknown) => error instanceof NativeHostError && error.failure === "host_failed" && /update running/.test(error.message));
});

test("a self_update reply with no updated flag is a bad reply", async () => {
  const { client } = watched_client(async () => ({ ok: true }), () => undefined);
  await assert.rejects(client.self_update({ version: "0.1.23", sha256: {} }), (error: unknown) => error instanceof NativeHostError && error.failure === "bad_reply");
});

test("the real host reports its release_version, which is dev in the repo", { skip: spawnSync("python3", ["--version"]).error !== undefined }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "desertfox-host-"));
  try {
    const seen: unknown[] = [];
    const send = async (message: object): Promise<unknown> => {
      const body = Buffer.from(JSON.stringify(message));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      const done = spawnSync("python3", ["-I", join(import.meta.dirname, "../../host/desertfox-host")], { input: Buffer.concat([header, body]), env: { PATH: process.env.PATH ?? "", DESERTFOX_CONFIG_DIR: dir } });
      assert.equal(done.status, 0, String(done.stderr));
      return JSON.parse(done.stdout.subarray(4).toString("utf8"));
    };
    const client = create_native_client({ has_permission: async () => true, send }, { seen: (release_version) => void seen.push(release_version), outdated_note: () => undefined });
    await client.read_config();
    assert.deepEqual(seen, ["dev"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the startup probe sends one request and reports the version, and sends nothing without the permission", async () => {
  for (const permitted of [true, false]) {
    const seen: unknown[] = [];
    const sent: object[] = [];
    const client = create_native_client(
      {
        has_permission: async () => permitted,
        send: async (message) => {
          sent.push(message);
          return { ok: true, release_version: "0.1.22", files: {} };
        },
      },
      { seen: (release_version) => void seen.push(release_version), outdated_note: () => undefined },
    );
    await client.probe().catch(() => undefined);
    assert.equal(sent.length, permitted ? 1 : 0);
    assert.deepEqual(seen, permitted ? ["0.1.22"] : []);
  }
});
