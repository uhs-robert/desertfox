// `rc` and `rC` clear site data and then reload.
// Measured here (Firefox 160): browsingData `hostnames` clears cookies, but leaves the cache and localStorage alone, for an IP (127.0.0.1) and for a made-up host name resolved through network.dns.localDomains. So `rc` clears the whole cache and the page clears its own storage.
import http from "node:http";
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["keys", "cmdline"];

export async function run_cases({ rdp, extension_id, run_case, setup, expect, open_page, press_keys, settle_focus, events, wait_event, wait_cmdline, in_active_tab, poll_until }) {
  const background = (code) => evaluate_in_background(rdp, extension_id, code);
  const loaded = (page_id, mark) => wait_event(mark, (event) => event.type === "tree_read" && event.page_id === page_id, `${page_id} to load again`);

  let hits = 0;
  const cached_server = http.createServer((request, response) => {
    hits++;
    response.writeHead(200, { "content-type": "text/plain", "cache-control": "max-age=3600", "access-control-allow-origin": "*" });
    response.end("x");
  });
  await new Promise((resolve) => cached_server.listen(0, "127.0.0.1", resolve));
  try {
  const { port } = cached_server.address();
  // True when the fetch reached the server, false when the cache answered.
  const reaches_server = async () => {
    const before = hits;
    await background(`fetch("http://127.0.0.1:${port}/cached").then((response) => response.text())`);
    return hits > before;
  };

  const set_site_data = () =>
    in_active_tab(`(async () => {
      document.cookie = "kt_cookie=1; path=/"; localStorage.setItem("kt", "1"); sessionStorage.setItem("kt", "1");
      await new Promise((done) => { const request = indexedDB.open("kt_db"); request.onsuccess = () => { self.kt_connection = request.result; done(); }; request.onerror = done; });
      await caches.open("kt_cache");
      document.documentElement.setAttribute("data-kt-before-reload", "1");
      return true;
    })()`);
  const read_site_data = () =>
    in_active_tab(`(async () => JSON.stringify({ cookie: document.cookie, local: localStorage.getItem("kt"), session: sessionStorage.getItem("kt"), dbs: (await indexedDB.databases()).map((db) => db.name), caches: await caches.keys() }))()`).then(JSON.parse);
  const is_clear = (data) => data.cookie === "" && data.local === null && data.session === null && data.dbs.length === 0 && data.caches.length === 0;

  await setup("open page d_clear", () => open_page("page", "d_clear", { new_tab: true }));

  for (const [name, keys, confirm] of [["rc", ["r", "c"], false], ["rC", ["r", "C"], true]]) {
    await run_case(`${name} clears cookies, storage and the cache, then reloads`, async () => {
      await set_site_data();
      const before = await read_site_data();
      expect(before.cookie.includes("kt_cookie") && before.dbs.includes("kt_db") && before.caches.includes("kt_cache"), `the site data was not set: ${JSON.stringify(before)}`);
      await reaches_server();
      expect(!(await reaches_server()), "the cache did not serve the second fetch, so the check proves nothing");
      const mark = events.length;
      await press_keys(...keys);
      if (confirm) {
        await wait_cmdline((line) => line.open && line.value === "page.reload --all", "rC to open the line with page.reload --all");
        await press_keys("-k", "Return");
      }
      // The marker lives in the old document, so it is gone only once the reload has replaced it. A late report from before the key cannot pass this.
      await poll_until("the old document to be replaced", async () => (await in_active_tab(`document.documentElement.getAttribute("data-kt-before-reload")`).catch(() => "navigating")) === null);
      await loaded("d_clear", mark);
      await settle_focus();
      const after = await read_site_data();
      expect(is_clear(after), `${name} left site data: ${JSON.stringify(after)}`);
      expect(await reaches_server(), `${name} left the cache in place`);
    });
  }

  await run_case("a database the page holds open blocks its delete, and browsingData hostnames does not clear it", async () => {
    await open_page("page", "d_idb", { new_tab: true });
    await set_site_data();
    const databases = () => in_active_tab(`(async () => JSON.stringify((await indexedDB.databases()).map((db) => db.name)))()`);
    const delete_result = await in_active_tab(`new Promise((done) => { const request = indexedDB.deleteDatabase("kt_db"); request.onblocked = () => done("blocked"); request.onsuccess = () => done("success"); setTimeout(() => done("timeout"), 2000); })`);
    expect(delete_result === "blocked", `the delete was ${delete_result}, so the page cannot hold a database open`);
    await background(`browser.browsingData.remove({ hostnames: ["127.0.0.1"], cookieStoreId: "firefox-default" }, { indexedDB: true })`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await databases()).includes("kt_db"), "browsingData indexedDB with hostnames cleared a held database, so the notice for it can go");
    // Closing the connection lets the pending delete finish. This is also what a reload does.
    await in_active_tab(`self.kt_connection.close(); true`);
    await poll_until("the pending delete to finish", async () => !(await databases()).includes("kt_db"));
  });

  } finally {
    cached_server.close();
  }
}
