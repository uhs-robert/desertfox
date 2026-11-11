import assert from "node:assert/strict";
import { test } from "node:test";
import { create_host_update, MANUAL_HINT, RETRY_AFTER_MS } from "../../src/background/host_update.ts";
import type { HostHashes, HostUpdateState } from "../../src/background/host_update.ts";
import type { SelfUpdateReply, SelfUpdateRequest } from "../../src/background/native_client.ts";

const EXTENSION = "0.1.23";
const HASHES: HostHashes = { version: EXTENSION, sha256: { "desertfox-host": "a".repeat(64), "desertfox-bridge": "b".repeat(64), desertfox: "c".repeat(64) } };

function make(options: { probed_version?: unknown; consent?: boolean; development?: boolean; hashes?: HostHashes | undefined; update?: (request: SelfUpdateRequest) => Promise<SelfUpdateReply>; extension_version?: string } = {}) {
  const calls: SelfUpdateRequest[] = [];
  const toasts: { message: string; kind: string }[] = [];
  const warnings: string[] = [];
  const reconnects: number[] = [];
  const state = { stored: {} as HostUpdateState, now: 1_000_000, consent: options.consent ?? true, toast_fails: false, probed: options.probed_version as unknown };
  const extension_version = options.extension_version ?? EXTENSION;
  const updater = create_host_update({
    extension_version,
    is_development: async () => options.development ?? false,
    read_hashes: async () => ("hashes" in options ? options.hashes : { ...HASHES, version: extension_version }),
    auto_update_consented: async () => state.consent,
    probe_host: async () => updater.watch.seen("probed_version" in options ? state.probed : "0.1.22"),
    update: async (request) => {
      calls.push(request);
      return options.update ? options.update(request) : { updated: true, version: request.version };
    },
    load_state: async () => structuredClone(state.stored),
    save_state: async (next) => void (state.stored = structuredClone(next)),
    now_ms: () => state.now,
    toast: async (message, kind) => {
      if (state.toast_fails) throw new Error("no tab");
      toasts.push({ message, kind });
    },
    warn: (text) => void warnings.push(text),
  });
  updater.on_updated(() => reconnects.push(state.now));
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
  return { updater, calls, toasts, warnings, reconnects, state, settle };
}

const refusing = (text: string) => async (): Promise<SelfUpdateReply> => Promise.reject(new Error(text));

test("an older host with consent is updated with the extension's own version and hashes", async () => {
  const test_case = make();
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.deepEqual(test_case.calls, [{ version: EXTENSION, sha256: HASHES.sha256 }]);
  assert.deepEqual(test_case.toasts, [{ message: `Native host updated to ${EXTENSION}`, kind: "success" }]);
});

test("a host that is equal or newer gets no call and no toast", async () => {
  const test_case = make();
  for (const version of [EXTENSION, "0.1.24", "0.2.0-beta.1"]) {
    test_case.updater.watch.seen(version);
    test_case.updater.bridge_ready(version);
  }
  await test_case.settle();
  assert.deepEqual(test_case.calls, []);
  assert.deepEqual(test_case.toasts, []);
});

test("a development host gets no call", async () => {
  const test_case = make();
  test_case.updater.watch.seen("dev");
  test_case.updater.bridge_ready("dev");
  await test_case.settle();
  assert.deepEqual(test_case.calls, []);
});

test("a development install of the extension never updates", async () => {
  const test_case = make({ development: true });
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.deepEqual(test_case.calls, []);
  assert.deepEqual(test_case.toasts, []);
  await assert.rejects(test_case.updater.update_now(), /development install/);
});

test("a build with no hashes, or hashes for another version, sends nothing", async () => {
  for (const hashes of [undefined, { ...HASHES, version: "0.1.22" }]) {
    const test_case = make({ hashes });
    test_case.updater.watch.seen("0.1.20");
    await test_case.settle();
    assert.deepEqual(test_case.calls, []);
  }
});

test("a host with no release_version predates the updater, so the line points to :native.install and nothing is sent", async () => {
  for (const consent of [true, false]) {
    const test_case = make({ consent });
    test_case.updater.watch.seen(undefined);
    await test_case.settle();
    test_case.updater.watch.seen(undefined);
    await test_case.settle();
    assert.deepEqual(test_case.calls, []);
    assert.equal(test_case.toasts.length, 1);
    assert.match(test_case.toasts[0]!.message, /:native\.install/);
    assert.match(test_case.updater.watch.outdated_note()!, /:native\.install/);
  }
});

test("without consent nothing is sent and one line names the manual command, once per version", async () => {
  const test_case = make({ consent: false });
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  test_case.updater.bridge_ready("0.1.22");
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.deepEqual(test_case.calls, []);
  assert.equal(test_case.toasts.length, 1);
  assert.match(test_case.toasts[0]!.message, /:native\.update/);
});

test("consent given later lets the next check update", async () => {
  const test_case = make({ consent: false });
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  test_case.state.consent = true;
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.equal(test_case.calls.length, 1);
});

test("an ok update reconnects the bridge once, and an already-current host reconnects it too", async () => {
  const test_case = make();
  test_case.updater.bridge_ready("0.1.22");
  await test_case.settle();
  assert.equal(test_case.reconnects.length, 1);

  const current = make({ update: async (request) => ({ updated: false, version: request.version }) });
  current.updater.bridge_ready("0.1.22");
  await current.settle();
  assert.equal(current.reconnects.length, 1);
  // An update that changed nothing shows no toast.
  assert.deepEqual(current.toasts, []);
});

test("a failed update does not reconnect, and shows one toast with the reason and the manual command", async () => {
  const test_case = make({ update: refusing("could not download the release: offline") });
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.deepEqual(test_case.reconnects, []);
  assert.deepEqual(test_case.toasts, [{ message: `Host update failed: could not download the release: offline. ${MANUAL_HINT}`, kind: "error" }]);
  assert.match(test_case.warnings.join("\n"), /offline/);
});

test("a failed update is not tried again within 24 hours, and its failure toast is not repeated", async () => {
  const test_case = make({ update: refusing("offline") });
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  for (const step of [60_000, 3_600_000, RETRY_AFTER_MS - 3_600_000 - 60_000 - 1]) {
    test_case.state.now += step;
    test_case.updater.watch.seen("0.1.22");
    test_case.updater.bridge_ready("0.1.22");
    await test_case.settle();
  }
  assert.equal(test_case.calls.length, 1);
  assert.equal(test_case.toasts.length, 1);
});

test("after 24 hours the update is tried once more, and a second failure of the same version shows no toast", async () => {
  const test_case = make({ update: refusing("offline") });
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  test_case.state.now += RETRY_AFTER_MS;
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.equal(test_case.calls.length, 2);
  assert.equal(test_case.toasts.length, 1);
  assert.equal(test_case.warnings.length, 2);
});

test("the retry that succeeds after a failure shows the success toast and reconnects", async () => {
  let fail = true;
  const test_case = make({ update: async (request) => (fail ? Promise.reject(new Error("offline")) : { updated: true, version: request.version }) });
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  fail = false;
  test_case.state.now += RETRY_AFTER_MS;
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.equal(test_case.reconnects.length, 1);
  assert.deepEqual(test_case.toasts.map((toast) => toast.kind), ["error", "success"]);
});

test("a new extension version failing shows its own toast", async () => {
  const stored: HostUpdateState = { attempted: { version: "0.1.22", at_ms: 0 }, failure_toasted: "0.1.22" };
  const test_case = make({ update: refusing("offline") });
  test_case.state.stored = stored;
  test_case.updater.watch.seen("0.1.20");
  await test_case.settle();
  assert.equal(test_case.calls.length, 1);
  assert.equal(test_case.toasts.length, 1);
});

test("the attempt time is stored before the call, so a restart in the middle does not retry at once", async () => {
  const test_case = make({ update: () => new Promise<SelfUpdateReply>(() => undefined) });
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.deepEqual(test_case.state.stored.attempted, { version: EXTENSION, at_ms: test_case.state.now });
});

test("a checksum mismatch blocks the version, even after 24 hours, until the extension changes", async () => {
  const test_case = make({ update: refusing("checksum mismatch for desertfox-host of version 0.1.23: the release does not match the hash the extension carries") });
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.equal(test_case.state.stored.blocked, EXTENSION);
  test_case.state.now += 10 * RETRY_AFTER_MS;
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.equal(test_case.calls.length, 1);
  // The next extension build carries other hashes for its own version, so the old block does not apply.
  const next = make({ extension_version: "0.1.24" });
  next.state.stored = test_case.state.stored;
  next.updater.watch.seen("0.1.22");
  await next.settle();
  assert.equal(next.calls.length, 1);
});

test("two checks at once send one update", async () => {
  let release: (() => void) | undefined;
  const test_case = make({ update: (request) => new Promise<SelfUpdateReply>((resolve) => void (release = () => resolve({ updated: true, version: request.version }))) });
  test_case.updater.watch.seen("0.1.22");
  test_case.updater.bridge_ready("0.1.22");
  await test_case.settle();
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.equal(test_case.calls.length, 1);
  release?.();
  await test_case.settle();
  assert.equal(test_case.toasts.length, 1);
});

test("the outdated note says updating while it runs and update failed after a refusal", async () => {
  let release: (() => void) | undefined;
  const test_case = make({ update: (request) => new Promise<SelfUpdateReply>((resolve, reject) => void (release = () => reject(new Error(`no release ${request.version}`)))) });
  assert.equal(test_case.updater.watch.outdated_note(), undefined);
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.equal(test_case.updater.watch.outdated_note(), "updating");
  release?.();
  await test_case.settle();
  assert.match(test_case.updater.watch.outdated_note()!, /^update failed: no release 0\.1\.23/);
  test_case.updater.watch.seen(EXTENSION);
  assert.equal(test_case.updater.watch.outdated_note(), undefined);
});

test("the manual command ignores consent, the daily limit and a block, and reconnects on success", async () => {
  const test_case = make({ consent: false });
  test_case.state.stored = { attempted: { version: EXTENSION, at_ms: test_case.state.now }, blocked: EXTENSION };
  assert.deepEqual(await test_case.updater.update_now(), { updated: true, version: EXTENSION });
  assert.equal(test_case.calls.length, 1);
  assert.equal(test_case.reconnects.length, 1);
  assert.equal(test_case.state.stored.blocked, undefined);
});

test("the manual command throws the host's reason and does not reconnect", async () => {
  const test_case = make({ update: refusing("refused to downgrade the host from 0.1.30 to 0.1.23") });
  await assert.rejects(test_case.updater.update_now(), /refused to downgrade/);
  assert.deepEqual(test_case.reconnects, []);
});

test("the manual command on a build with no hashes says so", async () => {
  const test_case = make({ hashes: undefined });
  await assert.rejects(test_case.updater.update_now(), /no host hashes/);
  assert.deepEqual(test_case.calls, []);
});

test("an automatic check during :native.update sends no second self_update", async () => {
  let release: (() => void) | undefined;
  const test_case = make({ update: (request) => new Promise<SelfUpdateReply>((resolve) => void (release = () => resolve({ updated: true, version: request.version }))) });
  const manual = test_case.updater.update_now();
  // Before the manual call reached the host, and while it waits for the reply.
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  test_case.updater.bridge_ready("0.1.22");
  await test_case.settle();
  assert.equal(test_case.calls.length, 1);
  release?.();
  await manual;
  assert.equal(test_case.calls.length, 1);
});

test("a second :native.update while one runs is refused", async () => {
  let release: (() => void) | undefined;
  const test_case = make({ update: (request) => new Promise<SelfUpdateReply>((resolve) => void (release = () => resolve({ updated: true, version: request.version }))) });
  const first = test_case.updater.update_now();
  await test_case.settle();
  await assert.rejects(test_case.updater.update_now(), /already running/);
  release?.();
  await first;
});

test("a toast that could not be shown is not recorded, so it shows again", async () => {
  const test_case = make({ consent: false });
  test_case.state.toast_fails = true;
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.equal(test_case.state.stored.noticed, undefined);
  test_case.state.toast_fails = false;
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.equal(test_case.toasts.length, 1);
  assert.equal(test_case.state.stored.noticed, EXTENSION);
});

test("a failure toast that could not be shown is not recorded, so the next failure shows it", async () => {
  const test_case = make({ update: refusing("offline") });
  test_case.state.toast_fails = true;
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.equal(test_case.state.stored.failure_toasted, undefined);
  assert.equal(test_case.state.stored.attempted?.version, EXTENSION);
  test_case.state.toast_fails = false;
  test_case.state.now += RETRY_AFTER_MS;
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.equal(test_case.toasts.length, 1);
  assert.equal(test_case.state.stored.failure_toasted, EXTENSION);
});

test("a success toast that fails does not turn an ok update into a failed one", async () => {
  const test_case = make();
  test_case.state.toast_fails = true;
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.equal(test_case.reconnects.length, 1);
  assert.equal(test_case.state.stored.blocked, undefined);
  assert.equal(test_case.state.stored.failure_toasted, undefined);
  assert.equal(test_case.updater.watch.outdated_note(), undefined);
});

test("a clock that moved back counts as an expired interval", async () => {
  const test_case = make({ update: refusing("offline") });
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  test_case.state.now -= 3_600_000;
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  assert.equal(test_case.calls.length, 2);
});

test("an old bridge with no version updates once the config host has reported its own version", async () => {
  const test_case = make();
  test_case.updater.watch.seen("0.1.22");
  await test_case.settle();
  test_case.updater.bridge_ready(undefined);
  await test_case.settle();
  assert.equal(test_case.calls.length, 1);
  assert.deepEqual(test_case.toasts.map((toast) => toast.kind), ["success"]);
});

test("a bridge with no version that comes before the config host's reply gets the install notice and no self_update", async () => {
  const test_case = make();
  test_case.updater.bridge_ready(undefined);
  await test_case.settle();
  test_case.updater.watch.seen(undefined);
  await test_case.settle();
  assert.deepEqual(test_case.calls, []);
  assert.deepEqual(test_case.toasts.map((toast) => toast.kind), ["info"]);
  assert.match(test_case.toasts[0]!.message, /:native\.install/);
});

test("the manual command on a host with no release_version refuses and sends nothing", async () => {
  const test_case = make({ probed_version: undefined });
  test_case.updater.watch.seen(undefined);
  await test_case.settle();
  await assert.rejects(test_case.updater.update_now(), /too old to update itself/);
  assert.deepEqual(test_case.calls, []);
});

test("the manual command probes the host first, so a manual install since the last reply is seen", async () => {
  const test_case = make({ probed_version: "0.1.22" });
  test_case.updater.watch.seen(undefined);
  await test_case.settle();
  assert.deepEqual(await test_case.updater.update_now(), { updated: true, version: EXTENSION });
  assert.equal(test_case.calls.length, 1);
});
