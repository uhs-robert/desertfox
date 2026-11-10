// `rc` and `rC` clear site data and then reload, and the per-host cache clear that `rc` relies on works in this Firefox.
import http from "node:http";
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["keys", "cmdline"];

export async function run_cases({ rdp, extension_id, run_case, setup, expect, open_page, press_keys, settle_focus, events, wait_event, wait_cmdline, in_active_tab, poll_until, close_cmdline }) {
  const background = (code) => evaluate_in_background(rdp, extension_id, code);
  const loaded = (page_id, mark) => wait_event(mark, (event) => event.type === "tree_read" && event.page_id === page_id, `${page_id} to load again`);

  await run_case("browsingData hostnames clears the cache of one host and keeps the other", async () => {
    let hits = 0;
    const cached_server = http.createServer((request, response) => {
      hits++;
      response.writeHead(200, { "content-type": "text/plain", "cache-control": "max-age=3600", "access-control-allow-origin": "*" });
      response.end(`hit ${hits}`);
    });
    await new Promise((resolve) => cached_server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = cached_server.address();
      const fetch_in_background = (host) => background(`fetch("http://${host}:${port}/cached/${host}").then((response) => response.text())`);
      const hits_after = async (host) => {
        const before = hits;
        await fetch_in_background(host);
        return hits - before;
      };
      expect(await hits_after("127.0.0.1") === 1, "the first fetch of 127.0.0.1 did not reach the server");
      expect(await hits_after("localhost") === 1, "the first fetch of localhost did not reach the server");
      expect(await hits_after("127.0.0.1") === 0, "the cache did not serve 127.0.0.1, so the check proves nothing");
      await background(`browser.browsingData.remove({ hostnames: ["127.0.0.1"] }, { cache: true, serviceWorkers: true }).then(() => "ok")`);
      expect(await hits_after("127.0.0.1") === 1, "hostnames did not clear the cache of 127.0.0.1");
      expect(await hits_after("localhost") === 0, "hostnames cleared the cache of localhost too");
      const rejected = await background(`browser.browsingData.remove({ hostnames: ["127.0.0.1"], cookieStoreId: "firefox-default" }, { cache: true }).then(() => "accepted", (error) => String(error.message))`);
      expect(rejected !== "accepted", "a cookieStoreId with cache was accepted, so the separate call is not needed");
    } finally {
      cached_server.close();
    }
  });

  const set_site_data = () => in_active_tab(`document.cookie = "kt_cookie=1; path=/"; localStorage.setItem("kt", "1"); sessionStorage.setItem("kt", "1"); true`);
  const read_site_data = () => in_active_tab(`JSON.stringify({ cookie: document.cookie, local: localStorage.getItem("kt"), session: sessionStorage.getItem("kt") })`).then(JSON.parse);

  await setup("open page d_clear", () => open_page("page", "d_clear", { new_tab: true }));

  await run_case("rc clears cookies and storage of the host, then reloads", async () => {
    await set_site_data();
    expect((await read_site_data()).cookie.includes("kt_cookie"), "the cookie was not set");
    const mark = events.length;
    await press_keys("r", "c");
    await loaded("d_clear", mark);
    await settle_focus();
    const after = await read_site_data();
    expect(after.cookie === "" && after.local === null && after.session === null, `rc left site data: ${JSON.stringify(after)}`);
  });

  await run_case("rC opens the line with page.reload --all, and Enter clears and reloads", async () => {
    await set_site_data();
    await press_keys("r", "C");
    await wait_cmdline((line) => line.open && line.value === "page.reload --all", "rC to open the line with page.reload --all");
    const mark = events.length;
    await press_keys("-k", "Return");
    await loaded("d_clear", mark);
    await settle_focus();
    const after = await read_site_data();
    expect(after.cookie === "" && after.local === null && after.session === null, `rC left site data: ${JSON.stringify(after)}`);
  });
}
