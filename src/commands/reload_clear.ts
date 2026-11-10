import { RuntimeRefusal } from "../shared/command.ts";

export type ClearScope = "site" | "all";

export type PageCookie = { name: string; domain: string; path: string; secure: boolean; store_id: string; first_party_domain: string; partition_key: unknown };

export type ReloadClearDeps = {
  tab_of: (tab_id: number) => Promise<{ url: string; cookie_store_id: string }>;
  // The cookies the page sends, which include the ones a parent domain set.
  cookies_sent_to: (url: string, store_id: string) => Promise<PageCookie[]>;
  remove_cookie: (cookie: PageCookie, url: string) => Promise<void>;
  remove_data: (options: { hostnames?: string[]; cookie_store_id?: string }, types: DataTypes) => Promise<void>;
  clear_session_storage: (tab_id: number) => Promise<void>;
  reload_bypassing_cache: (tab_id: number) => Promise<void>;
};

export type DataTypes = { cookies?: true; localStorage?: true; indexedDB?: true; serviceWorkers?: true; cache?: true };

// Types that Firefox clears for a container store. The rest reject a call that names one.
const STORE_TYPES: DataTypes = { cookies: true, localStorage: true, indexedDB: true };
// Types with no container split: a call that names a store rejects the whole call, so these go in a call without one.
const SHARED_TYPES: DataTypes = { serviceWorkers: true, cache: true };
const ALL_TYPES: DataTypes = { ...STORE_TYPES, ...SHARED_TYPES };

const WEB_SCHEMES = new Set(["http:", "https:"]);

const cookie_host = (cookie: PageCookie): string => cookie.domain.replace(/^\./, "");

const cookie_url = (cookie: PageCookie): string => `${cookie.secure ? "https" : "http"}://${cookie_host(cookie)}${cookie.path}`;

export function make_reload_clear(deps: ReloadClearDeps) {
  async function clear_site(tab_id: number): Promise<void> {
    const tab = await deps.tab_of(tab_id);
    const url = new URL(tab.url, "about:blank");
    if (!WEB_SCHEMES.has(url.protocol)) throw new RuntimeRefusal("Only a web page has site data to clear");
    const host = url.hostname;
    const store = tab.cookie_store_id;
    // Read before the clear removes them. The host's own cookies go with the storage call, so only parent-domain ones are left to remove.
    const parent_cookies = (await deps.cookies_sent_to(tab.url, store)).filter((cookie) => cookie_host(cookie) !== host);
    await Promise.all([
      deps.remove_data({ hostnames: [host], cookie_store_id: store }, STORE_TYPES),
      deps.remove_data({ hostnames: [host] }, SHARED_TYPES),
      ...parent_cookies.map((cookie) => deps.remove_cookie(cookie, cookie_url(cookie))),
    ]);
  }

  return {
    // The clear must finish before the reload, or the reload sends the old cookies. A failed clear stops the reload, so the page never reloads half cleared.
    run: async (tab_id: number, scope: ClearScope): Promise<void> => {
      try {
        await deps.clear_session_storage(tab_id);
        if (scope === "all") await deps.remove_data({}, ALL_TYPES);
        else await clear_site(tab_id);
      } catch (error) {
        if (error instanceof RuntimeRefusal) throw error;
        throw new RuntimeRefusal(`Could not clear the site data: ${error instanceof Error ? error.message : String(error)}`);
      }
      await deps.reload_bypassing_cache(tab_id);
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
    (await browser.cookies.getAll({ url, storeId: store_id, partitionKey: {} })).map((cookie) => ({
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
  // A fixed code string in the background, not a content-script message: the content script is at its size limit. A tab with no scriptable page rejects, and then has no sessionStorage to clear.
  clear_session_storage: async (tab_id) => {
    await browser.tabs.executeScript(tab_id, { code: "try { sessionStorage.clear(); } catch {}", allFrames: true }).catch(() => undefined);
  },
  reload_bypassing_cache: (tab_id) => browser.tabs.reload(tab_id, { bypassCache: true }),
};
