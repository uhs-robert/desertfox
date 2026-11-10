import { notify } from "../background/browser_deps.ts";
import { RuntimeRefusal } from "../shared/command.ts";

export type ClearScope = "site" | "all";

export type PageCookie = { name: string; domain: string; path: string; secure: boolean; store_id: string; first_party_domain: string; partition_key: unknown };

export type ReloadClearDeps = {
  tab_of: (tab_id: number) => Promise<{ url: string; cookie_store_id: string }>;
  // The cookies the page sends, which include the ones a parent domain set.
  cookies_sent_to: (url: string, store_id: string) => Promise<PageCookie[]>;
  remove_cookie: (cookie: PageCookie, url: string) => Promise<void>;
  remove_data: (options: { hostnames?: string[]; cookie_store_id?: string }, types: DataTypes) => Promise<void>;
  // The names of what stayed: a page that cannot run the script, a step that hangs and a database held open by the page all leave something behind.
  clear_page_storage: (tab_id: number) => Promise<string[]>;
  notify: (message: string) => Promise<void>;
  reload_bypassing_cache: (tab_id: number) => Promise<void>;
};

export type DataTypes = { cookies?: true; localStorage?: true; indexedDB?: true; serviceWorkers?: true; cache?: true };

// Firefox ignores `hostnames` for the cache, localStorage and service workers (measured in the key test, with an IP and with a made-up host name), so a site clear takes only the cookies by host name.
// The page clears its own storage, and the whole HTTP cache goes: it holds no cookies and refills on the next load. The cache call carries no cookieStoreId, which Firefox rejects for it.
const SITE_COOKIES: DataTypes = { cookies: true };
const WHOLE_CACHE: DataTypes = { cache: true };
const ALL_TYPES: DataTypes = { cookies: true, localStorage: true, indexedDB: true, serviceWorkers: true, cache: true };

const INDEXED_DB = "IndexedDB";
const STEP_TIMEOUT_MS = 3000;
// The backstop when the script itself never answers.
const SCRIPT_TIMEOUT_MS = 8000;
const PAGE_STEPS = ["storage", INDEXED_DB, "Cache Storage", "service workers"];
const WEB_SCHEMES = new Set(["http:", "https:"]);

const cookie_host = (cookie: PageCookie): string => cookie.domain.replace(/^\./, "");

const cookie_url = (cookie: PageCookie): string => `${cookie.secure ? "https" : "http"}://${cookie_host(cookie)}${cookie.path}`;

// A fixed code string run from the background, not a content-script message: the content script is at its size limit.
// Each step runs alone with its own timer, because a page can block or stall one store and the rest must still clear. The answer is the names of the steps that failed or timed out.
// A database delete that fires `blocked` is held open by the page, so it counts as stayed.
const PAGE_STORAGE_CLEAR = `(async () => {
  const stayed = [];
  const attempt = async (name, step) => {
    const timeout = new Promise((_, fail) => setTimeout(fail, ${STEP_TIMEOUT_MS}));
    try { await Promise.race([step(), timeout]); } catch { stayed.push(name); }
  };
  await Promise.all([
    attempt("storage", async () => { sessionStorage.clear(); localStorage.clear(); }),
    attempt("${INDEXED_DB}", async () => {
      for (const { name } of await indexedDB.databases()) {
        await new Promise((done, fail) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => done(); request.onerror = request.onblocked = () => fail(); });
      }
    }),
    attempt("Cache Storage", async () => { for (const key of await caches.keys()) await caches.delete(key); }),
    attempt("service workers", async () => { for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister(); }),
  ]);
  return stayed;
})()`;

export function make_reload_clear(deps: ReloadClearDeps) {
  // Checks the page first, so a page with no site data (a file: page, an about: page) refuses before anything is cleared.
  async function site_target(tab_id: number) {
    const tab = await deps.tab_of(tab_id);
    const url = new URL(tab.url, "about:blank");
    if (!WEB_SCHEMES.has(url.protocol)) throw new RuntimeRefusal("Only a web page has site data to clear");
    return { url: tab.url, host: url.hostname, store: tab.cookie_store_id };
  }

  async function clear_site(target: { url: string; host: string; store: string }): Promise<void> {
    // Read before the clear removes them. Only the cookies the page sends, so the lookup leaves partitioned cookies of other sites alone. The host's own cookies go with the hostnames call, so only parent-domain ones are left to remove.
    const parent_cookies = (await deps.cookies_sent_to(target.url, target.store)).filter((cookie) => cookie_host(cookie) !== target.host);
    await Promise.all([
      deps.remove_data({ hostnames: [target.host], cookie_store_id: target.store }, SITE_COOKIES),
      deps.remove_data({}, WHOLE_CACHE),
      ...parent_cookies.map((cookie) => deps.remove_cookie(cookie, cookie_url(cookie))),
    ]);
  }

  return {
    // The clear must finish before the reload, or the reload sends the old cookies. A failed cookie or cache clear stops the reload. A page that cannot clear its own storage does not: the reload goes on and a notice names what stayed.
    run: async (tab_id: number, scope: ClearScope): Promise<void> => {
      const target = scope === "site" ? await site_target(tab_id) : undefined;
      let stayed: string[] = [];
      try {
        stayed = await deps.clear_page_storage(tab_id);
        if (target === undefined) {
          await deps.remove_data({}, ALL_TYPES);
          stayed = [];
        } else {
          await clear_site(target);
          // A database the page holds open blocks its own delete, so ask the browser for the host's.
          if (stayed.includes(INDEXED_DB)) {
            await deps.remove_data({ hostnames: [target.host], cookie_store_id: target.store }, { indexedDB: true });
            stayed = stayed.filter((name) => name !== INDEXED_DB);
          }
        }
      } catch (error) {
        if (error instanceof RuntimeRefusal) throw error;
        throw new RuntimeRefusal(`Could not clear the site data: ${error instanceof Error ? error.message : String(error)}`);
      }
      await deps.reload_bypassing_cache(tab_id);
      if (stayed.length > 0) await deps.notify(`Cleared the cookies and the cache, but this page's ${stayed.join(", ")} stayed.`);
    },
  };
}

export const browser_reload_clear_deps: ReloadClearDeps = {
  tab_of: async (tab_id) => {
    const tab = await browser.tabs.get(tab_id);
    if (!tab.url) throw new RuntimeRefusal("This tab has no address");
    return { url: tab.url, cookie_store_id: tab.cookieStoreId ?? "firefox-default" };
  },
  cookies_sent_to: async (url, store_id) =>
    (await browser.cookies.getAll({ url, storeId: store_id })).map((cookie) => ({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      store_id: cookie.storeId,
      first_party_domain: cookie.firstPartyDomain,
      partition_key: cookie.partitionKey,
    })),
  remove_cookie: async (cookie, url) => {
    await browser.cookies.remove({
      url,
      name: cookie.name,
      storeId: cookie.store_id,
      firstPartyDomain: cookie.first_party_domain,
      ...(cookie.partition_key === undefined ? {} : { partitionKey: cookie.partition_key as browser.cookies.PartitionKey }),
    });
  },
  remove_data: (options, types) =>
    browser.browsingData.remove({ ...(options.hostnames && { hostnames: options.hostnames }), ...(options.cookie_store_id && { cookieStoreId: options.cookie_store_id }) }, types),
  clear_page_storage: async (tab_id) => {
    const timer = new Promise<undefined>((resolve) => setTimeout(resolve, SCRIPT_TIMEOUT_MS));
    try {
      // A page the browser does not let us script (addons.mozilla.org, an error page) rejects.
      const answer = await Promise.race([browser.tabs.executeScript(tab_id, { code: PAGE_STORAGE_CLEAR }), timer]);
      const stayed = answer?.[0];
      return Array.isArray(stayed) ? (stayed as string[]) : PAGE_STEPS;
    } catch {
      return PAGE_STEPS;
    }
  },
  notify: (message) => notify({ id: "reload_clear", message }),
  reload_bypassing_cache: (tab_id) => browser.tabs.reload(tab_id, { bypassCache: true }),
};
