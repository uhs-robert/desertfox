import assert from "node:assert/strict";
import { test } from "node:test";
import "../../src/background/command_modules.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import type { CommandContext } from "../../src/shared/command.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { require_openable } from "../../src/shared/url_build.ts";

const CTX: CommandContext = { tab_id: 7, window_id: 3, frame_id: 0, mode: "normal" };
const globals = globalThis as Record<string, unknown>;

function stub(rejection?: Error) {
  const toggled: number[] = [];
  globals.browser = {
    tabs: {
      toggleReaderMode: async (tab_id: number) => {
        toggled.push(tab_id);
        if (rejection) throw rejection;
      },
    },
  };
  return toggled;
}

const run = async () => void (await registry.get("page.reader")!.run!(CTX, {}));

test("page.reader toggles Reader View on the active tab", async () => {
  const toggled = stub();
  await run();
  assert.deepEqual(toggled, [7]);
});

test("a not-readable rejection from Firefox becomes the refusal", async () => {
  stub(new Error("The specified tab cannot be placed into reader mode."));
  await assert.rejects(run, (error: unknown) => error instanceof RuntimeRefusal && /cannot show this page in Reader View/.test(error.message));
});

test("another rejection, such as a closed tab, keeps its own text", async () => {
  stub(new Error("Invalid tab ID: 7"));
  await assert.rejects(run, (error: unknown) => !(error instanceof RuntimeRefusal) && /Invalid tab ID: 7/.test((error as Error).message));
});

test("an about:reader address points at the gr key, other about: pages keep the general text", () => {
  assert.throws(() => require_openable("about:reader?url=https%3A%2F%2Fa.example", undefined), /about:reader.*Press gr/);
  assert.throws(() => require_openable("about:config", undefined), /does not open about: addresses/);
});
