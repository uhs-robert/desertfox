import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { create_native_client, NativeHostError } from "../../src/background/native_client.ts";
import type { NativeFailure } from "../../src/background/native_client.ts";

const client_with = (reply: () => Promise<unknown>, permitted = true) => {
  const sent: object[] = [];
  const client = create_native_client({
    has_permission: async () => permitted,
    send: async (message) => {
      sent.push(message);
      return reply();
    },
  });
  return { client, sent };
};

async function failure_of(run: () => Promise<unknown>): Promise<NativeFailure> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof NativeHostError, String(error));
    return error.failure;
  }
  assert.fail("expected a NativeHostError");
}

test("without the permission nothing is sent and the message names the way forward", async () => {
  const { client, sent } = client_with(async () => ({ ok: true, files: {} }), false);
  await assert.rejects(client.read_config(), (error: unknown) => error instanceof NativeHostError && error.failure === "no_permission" && /:native\.install/.test(error.message));
  assert.deepEqual(sent, []);
});

test("a host that Firefox cannot find says it is not installed", async () => {
  const { client } = client_with(async () => Promise.reject(new Error("No such native application desertfox_host")));
  assert.equal(await failure_of(() => client.read_config()), "host_missing");
});

test("any other Firefox failure keeps Firefox's words", async () => {
  const { client } = client_with(async () => Promise.reject(new Error("Native application exited")));
  await assert.rejects(client.read_config(), (error: unknown) => error instanceof NativeHostError && error.failure === "host_failed" && error.message.includes("Native application exited"));
});

test("a host refusal carries the host's reason, for example the size cap", async () => {
  const { client } = client_with(async () => ({ ok: false, error: "the reply is 2000000 bytes, over the cap" }));
  await assert.rejects(client.read_config(), (error: unknown) => error instanceof NativeHostError && error.message.includes("the reply is 2000000 bytes"));
});

test("a reply that is not the protocol is a bad reply", async () => {
  for (const reply of [undefined, "text", { files: {} }, { ok: true }, { ok: true, files: { "a.toml": 3 } }]) {
    const { client } = client_with(async () => reply);
    assert.equal(await failure_of(() => client.read_config()), "bad_reply", JSON.stringify(reply));
  }
});

test("read_config returns the files and write_autoconfig sends the text", async () => {
  const { client, sent } = client_with(async () => ({ ok: true, config_dir: "/c", config_dir_exists: true, files: { "settings.toml": "a = 1\n" } }));
  assert.deepEqual(await client.read_config(), { config_dir: "/c", config_dir_exists: true, files: { "settings.toml": "a = 1\n" } });
  await client.write_autoconfig("x = 1\n");
  assert.deepEqual(sent, [{ cmd: "read_config" }, { cmd: "write_autoconfig", toml: "x = 1\n" }]);
});

// The real host over its real framing, pointed at a temporary folder.
function spawn_host(request: object, config_dir: string): unknown {
  const body = Buffer.from(JSON.stringify(request));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  const done = spawnSync("python3", ["-I", join(import.meta.dirname, "../../host/desertfox-host")], {
    input: Buffer.concat([header, body]),
    env: { PATH: process.env.PATH ?? "", DESERTFOX_CONFIG_DIR: config_dir },
  });
  assert.equal(done.status, 0, String(done.stderr));
  return JSON.parse(done.stdout.subarray(4).toString("utf8"));
}

test("the client and the real host agree on both requests", { skip: spawnSync("python3", ["--version"]).error !== undefined }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "desertfox-host-"));
  try {
    mkdirSync(join(dir, "snippets"));
    writeFileSync(join(dir, "settings.toml"), "a = 1\n");
    writeFileSync(join(dir, "snippets", "a.js"), "// a\n");
    const client = create_native_client({ has_permission: async () => true, send: async (message) => spawn_host(message, dir) });
    const read = await client.read_config();
    assert.deepEqual(read.files, { "settings.toml": "a = 1\n", "snippets/a.js": "// a\n" });
    await client.write_autoconfig("b = 2\n");
    assert.match(readFileSync(join(dir, "autoconfig.toml"), "utf8"), /b = 2\n$/);
    assert.deepEqual(Object.keys((await client.read_config()).files).sort(), ["settings.toml", "snippets/a.js"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
