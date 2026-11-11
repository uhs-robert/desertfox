import assert from "node:assert/strict";
import { test } from "node:test";
import "../src/background/command_modules.ts";
import { ask_for_permission, create_panel_controller } from "../src/help/grant_panel.ts";
import { registry } from "../src/shared/registry/builtin.ts";
import { check_args } from "../src/shared/registry/check_args.ts";

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

test("a denied site-clear request says the keys stay off", async () => {
  const outcome = await ask_for_permission({ has: async () => false, request: async () => false }, "browsingData");
  assert.equal(outcome.granted, false);
  assert.match(outcome.message, /did not grant/);
  assert.match(outcome.message, /stay off/);
});

test("a granted site-clear request says the keys work", async () => {
  const outcome = await ask_for_permission({ has: async () => false, request: async () => true }, "browsingData");
  assert.match(outcome.message, /work now/);
});

test("native.install and permissions.grant are registered background commands", () => {
  assert.equal(registry.get("native.install")?.runs_in, "background");
  assert.equal(registry.get("permissions.grant")?.runs_in, "background");
});

test("permissions.grant takes only a grantable permission", () => {
  const command = registry.get("permissions.grant")!;
  assert.equal(check_args(command, { permission: "browsingData" }, {}).ok, true);
  assert.equal(check_args(command, { permission: "history" }, {}).ok, false);
  assert.equal(check_args(command, {}, {}).ok, false);
});

function deferred_builds() {
  const resolvers: (() => void)[] = [];
  let count = 0;
  const shown: number[] = [];
  const hidden: number[] = [];
  let wanted = true;
  let wanted_key = "a";
  const controller = create_panel_controller<number>({
    wanted: () => (wanted ? wanted_key : undefined),
    build: () => new Promise((resolve) => { const id = ++count; resolvers.push(() => resolve(id)); }),
    show: (panel) => shown.push(panel),
    hide: (panel) => hidden.push(panel),
  });
  return { controller, resolvers, shown, hidden, set_wanted: (value: boolean) => { wanted = value; }, set_key: (value: string) => { wanted_key = value; } };
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

test("a route change to another permission replaces the shown panel", async () => {
  const { controller, resolvers, shown, hidden, set_key } = deferred_builds();
  const first = controller.sync();
  resolvers[0]!();
  await first;
  set_key("b");
  const again = controller.sync();
  resolvers[1]!();
  await again;
  assert.deepEqual(hidden, [1]);
  assert.deepEqual(shown, [1, 2]);
});
