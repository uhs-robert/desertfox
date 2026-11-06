import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { ask_for_permission, create_panel_controller } from "../src/help/native_install.ts";
import { registry } from "../src/shared/registry/index.ts";

test("a granted request says what to do next", async () => {
  const outcome = await ask_for_permission({ has: async () => false, request: async () => true });
  assert.equal(outcome.granted, true);
  assert.match(outcome.message, /terminal/);
});

test("a denied request says so and how to retry, not nothing", async () => {
  const outcome = await ask_for_permission({ has: async () => false, request: async () => false });
  assert.equal(outcome.granted, false);
  assert.match(outcome.message, /did not grant/);
});

test("a request that throws, for example outside a click, shows Firefox's reason", async () => {
  const outcome = await ask_for_permission({
    has: async () => false,
    request: async () => Promise.reject(new Error("permissions.request may only be called from a user input handler")),
  });
  assert.equal(outcome.granted, false);
  assert.match(outcome.message, /user input handler/);
});

test("native.install is a registered background command", () => {
  assert.equal(registry.get("native.install")?.runs_in, "background");
});

function deferred_builds() {
  const resolvers: (() => void)[] = [];
  let count = 0;
  const shown: number[] = [];
  const hidden: number[] = [];
  let wanted = true;
  const controller = create_panel_controller<number>({
    is_wanted: () => wanted,
    build: () => new Promise((resolve) => { const id = ++count; resolvers.push(() => resolve(id)); }),
    show: (panel) => shown.push(panel),
    hide: (panel) => hidden.push(panel),
  });
  return { controller, resolvers, shown, hidden, set_wanted: (value: boolean) => { wanted = value; } };
}

test("two quick route changes during the build show one panel", async () => {
  const { controller, resolvers, shown } = deferred_builds();
  const first = controller.sync();
  const second = controller.sync();
  resolvers.forEach((resolve) => resolve());
  await Promise.all([first, second]);
  assert.equal(shown.length, 1);
});

test("a build that finishes after the route left shows nothing", async () => {
  const { controller, resolvers, shown, set_wanted } = deferred_builds();
  const pending = controller.sync();
  set_wanted(false);
  resolvers[0]!();
  await pending;
  assert.deepEqual(shown, []);
});

test("leaving the route hides the shown panel and a return builds a new one", async () => {
  const { controller, resolvers, shown, hidden, set_wanted } = deferred_builds();
  const first = controller.sync();
  resolvers[0]!();
  await first;
  set_wanted(false);
  await controller.sync();
  assert.deepEqual(hidden, [1]);
  set_wanted(true);
  const again = controller.sync();
  resolvers[1]!();
  await again;
  assert.deepEqual(shown, [1, 2]);
});

test("after Close, a repeated open shows the panel again", async () => {
  const { controller, resolvers, shown, hidden } = deferred_builds();
  const first = controller.sync();
  resolvers[0]!();
  await first;
  controller.close();
  assert.deepEqual(hidden, [1]);
  const again = controller.sync();
  resolvers[1]!();
  await again;
  assert.deepEqual(shown, [1, 2]);
});
