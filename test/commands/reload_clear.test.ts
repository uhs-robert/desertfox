import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { make_reload_clear, PAGE_STORAGE_CLEAR } from "../../src/commands/reload_clear.ts";
import type { PageCookie, ReloadClearDeps } from "../../src/commands/reload_clear.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import "../../src/background/command_modules.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";

const cookie = (domain: string, name: string): PageCookie => ({ name, domain, path: "/", secure: true, store_id: "firefox-container-2", first_party_domain: "", partition_key: undefined });

function make_fake({ url = "https://www.example.com/a", store = "firefox-container-2", cookies = [] as PageCookie[], fail_on = "", stayed = [] as string[], permitted = true } = {}) {
  const log: string[] = [];
  const data_calls: { options: unknown; types: string[] }[] = [];
  const deps: ReloadClearDeps = {
    has_clear_permissions: async () => permitted,
    tab_of: async () => ({ url, cookie_store_id: store }),
    cookies_sent_to: async (sent_url, store_id) => {
      log.push(`cookies ${sent_url} ${store_id}`);
      return cookies;
    },
    remove_cookie: async (c, remove_url) => {
      if (fail_on === "cookie") throw new Error("boom");
      await Promise.resolve();
      log.push(`remove_cookie ${c.name} ${remove_url}`);
    },
    remove_data: async (options, types) => {
      if (fail_on === "data") throw new Error("boom");
      // Yield, so a reload that does not wait for the clear would log first.
      await new Promise((resolve) => setTimeout(resolve, 5));
      data_calls.push({ options, types: Object.keys(types) });
      log.push("data");
    },
    clear_page_storage: async () => {
      log.push("page_storage");
      return stayed;
    },
    notify: async (message) => void log.push(`notify ${message}`),
    reload_bypassing_cache: async () => void log.push("reload"),
  };
  return { deps, log, data_calls };
}

test("site clear names the exact host, keeps the store off the cache call and clears before it reloads", async () => {
  const { deps, log, data_calls } = make_fake({ cookies: [cookie("www.example.com", "host_only"), cookie(".example.com", "login")] });
  await make_reload_clear(deps).run(7, "site");
  assert.deepEqual(data_calls[0], { options: { hostnames: ["www.example.com"], cookie_store_id: "firefox-container-2" }, types: ["cookies"] });
  assert.deepEqual(data_calls[1], { options: {}, types: ["cache"] });
  assert.equal(log.at(-1), "reload");
  assert.equal(log.filter((entry) => entry === "reload").length, 1);
  assert.ok(log.indexOf("data") < log.indexOf("reload"));
  assert.ok(log.includes("remove_cookie login https://example.com/"));
  assert.ok(!log.some((entry) => entry.includes("host_only")), "the host's own cookies go with the storage call");
  assert.ok(log.indexOf("page_storage") < log.indexOf("reload"));
});

test("all clear sends no hostnames and no store", async () => {
  const { deps, log, data_calls } = make_fake();
  await make_reload_clear(deps).run(7, "all");
  assert.deepEqual(data_calls, [{ options: {}, types: ["cookies", "localStorage", "indexedDB", "serviceWorkers", "cache"] }]);
  assert.equal(log.at(-1), "reload");
});

test("a missing permission refuses with the grant hint before anything runs, for both scopes", async () => {
  for (const scope of ["site", "all"] as const) {
    const { deps, log } = make_fake({ permitted: false });
    await assert.rejects(make_reload_clear(deps).run(7, scope), (error) => error instanceof RuntimeRefusal && /:permissions\.grant browsingData/.test(error.message));
    assert.deepEqual(log, [], scope);
  }
});

test("a failed clear refuses and does not reload", async () => {
  for (const fail_on of ["data", "cookie"]) {
    const { deps, log } = make_fake({ fail_on, cookies: [cookie(".example.com", "login")] });
    await assert.rejects(make_reload_clear(deps).run(7, "site"), RuntimeRefusal);
    assert.ok(!log.includes("reload"), fail_on);
  }
});

test("a page that is not on the web refuses a site clear", async () => {
  const { deps, log } = make_fake({ url: "about:config" });
  await assert.rejects(make_reload_clear(deps).run(7, "site"), RuntimeRefusal);
  assert.ok(!log.includes("reload"));
  assert.ok(!log.includes("page_storage") && data_calls_empty(log), "nothing was cleared before the refusal");
});

const data_calls_empty = (log: string[]) => !log.some((entry) => entry === "data" || entry.startsWith("remove_cookie"));

test("a file page refuses before anything is cleared", async () => {
  const { deps, log } = make_fake({ url: "file:///tmp/a.html" });
  await assert.rejects(make_reload_clear(deps).run(7, "site"), RuntimeRefusal);
  assert.deepEqual(log, []);
});

test("a page that cannot clear its storage still reloads and a notice names what stayed", async () => {
  const { deps, log } = make_fake({ stayed: ["storage", "service workers"] });
  await make_reload_clear(deps).run(7, "site");
  assert.equal(log.at(-2), "reload");
  assert.match(log.at(-1)!, /^notify .*storage, service workers stayed/);
});

test("a database the page holds open stays in the notice, and browsingData is not asked for it", async () => {
  const { deps, log, data_calls } = make_fake({ stayed: ["IndexedDB"] });
  await make_reload_clear(deps).run(7, "site");
  assert.ok(data_calls.every((call) => !call.types.includes("indexedDB")));
  assert.match(log.at(-1)!, /^notify .*IndexedDB stayed/);
});

test("the clear param takes site and all, and leaves a plain reload alone", () => {
  const command = registry.get("page.reload")!;
  assert.equal(check_args(command, { clear: "site" }, {}).ok, true);
  assert.equal(check_args(command, { clear: "all", hard: true }, {}).ok, true);
  assert.equal(check_args(command, { clear: "nothing" }, {}).ok, false);
  const plain = check_args(command, {}, {});
  assert.ok(plain.ok && plain.args.clear === "");
});

test(". and a macro never replay page.reload --all, but replay --site", async () => {
  const { can_repeat } = await import("../../src/background/record_step.ts");
  const command = registry.get("page.reload")!;
  assert.equal(can_repeat(command, { args: { clear: "all" } }), false);
  assert.equal(can_repeat(command, { args: { clear: "site" } }), true);
  assert.equal(can_repeat(command, { args: { hard: true } }), true);
  assert.equal(can_repeat(command, {}), true);
});

test("a macro and the repeat memory both drop page.reload --all and keep the rest", async () => {
  const { create_macro_recorder } = await import("../../src/background/macro_recorder.ts");
  const { create_step_recorder } = await import("../../src/background/record_step.ts");
  const values = new Map<string, unknown>();
  const session = {
    get: async (key: string) => (values.has(key) ? { [key]: structuredClone(values.get(key)) } : {}),
    set: async (items: Record<string, unknown>) => void Object.entries(items).forEach(([key, value]) => values.set(key, structuredClone(value))),
    remove: async (key: string) => void values.delete(key),
  } as never;
  const macro = create_macro_recorder({ session: () => session, tell_tabs: async () => undefined, get_command: (id) => registry.get(id) });
  await macro.start("a", false);
  const steps = [{ id: "page.reload", args: { clear: "all" } }, { id: "page.reload", args: { clear: "site" } }];
  await macro.record(steps, { ok: true }, { is_private: false });
  assert.deepEqual((await macro.stop(false)).steps, [steps[1]]);

  const saved: unknown[][] = [];
  const record = create_step_recorder({ get_command: (id) => registry.get(id), repeat_memory: { save: async (kept: unknown[]) => void saved.push(kept) } as never });
  await record([steps[0]!], { ok: true }, { is_private: false });
  assert.deepEqual(saved, [], "`.` would repeat the clear of every site");
  await record(steps, { ok: true }, { is_private: false });
  assert.deepEqual(saved, [[steps[1]]]);
});

test("the page script skips Cache Storage and service workers where the page has no secure-context APIs", async () => {
  const empty_storage = { clear: () => {} };
  const page = { sessionStorage: empty_storage, localStorage: empty_storage, indexedDB: { databases: async () => [] }, navigator: {}, setTimeout };
  const stayed = await vm.runInNewContext(PAGE_STORAGE_CLEAR, page);
  assert.deepEqual([...stayed], []);
});
