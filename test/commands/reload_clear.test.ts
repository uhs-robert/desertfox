import assert from "node:assert/strict";
import { test } from "node:test";
import { make_reload_clear } from "../../src/commands/reload_clear.ts";
import type { PageCookie, ReloadClearDeps } from "../../src/commands/reload_clear.ts";
import { RuntimeRefusal } from "../../src/shared/command.ts";
import "../../src/background/command_modules.ts";
import { registry } from "../../src/shared/registry/builtin.ts";
import { check_args } from "../../src/shared/registry/check_args.ts";

const cookie = (domain: string, name: string): PageCookie => ({ name, domain, path: "/", secure: true, store_id: "firefox-container-2", first_party_domain: "", partition_key: undefined });

function make_fake({ url = "https://www.example.com/a", store = "firefox-container-2", cookies = [] as PageCookie[], fail_on = "" } = {}) {
  const log: string[] = [];
  const data_calls: { options: unknown; types: string[] }[] = [];
  const deps: ReloadClearDeps = {
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
    clear_page_storage: async () => void log.push("page_storage"),
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
});

test("the clear param takes site and all, and leaves a plain reload alone", () => {
  const command = registry.get("page.reload")!;
  assert.equal(check_args(command, { clear: "site" }, {}).ok, true);
  assert.equal(check_args(command, { clear: "all", hard: true }, {}).ok, true);
  assert.equal(check_args(command, { clear: "nothing" }, {}).ok, false);
  const plain = check_args(command, {}, {});
  assert.ok(plain.ok && plain.args.clear === "");
});
