// Macro replay: @<reg> plays a macro, a real hint pick inside it takes its label while the keys typed before it wait, Escape stops a replay and drops those keys, and a step that switches tabs holds the keys of the new tab until the end.
import { createServer } from "node:http";

export const areas = ["keys", "hints", "tabs"];

export async function run_cases({ run_case, open_page, poll_until, press_keys, hint_label_count, wait_event, events, in_active_tab, in_background, badge_is, settle_focus, wait_active_tab, close_tabs_with, barrier, on_teardown, sleep, expect }) {
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;
  const scroll_y = () => in_active_tab("Math.round(scrollY)");
  const bottom_y = () => in_active_tab("Math.round(document.documentElement.scrollHeight - innerHeight)");
  const to_top = async () => {
    await press_keys("gg");
    await poll_until("the page to be at the top", async () => (await scroll_y()) === 0);
  };
  // A macro written straight into the register store, as the recorder stores one.
  const store_macro = (name, steps) => in_background(`browser.storage.local.set({ ${JSON.stringify(`desertfox_register_${name}`)}: ${JSON.stringify(steps)} })`);
  const active_tab_status = () => in_background(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab.status)`);

  // A server of its own: /hang never answers, so a navigation to it stays loading, and /nothing answers 204 after a pause, which ends the load and keeps the page.
  const pending = new Set();
  const slow_server = createServer((request, response) => {
    if (request.url.startsWith("/hang")) return void pending.add(response);
    // The /chain pages hold real links, so a hint pick on one loads the next, and /chain2 answers late so its `loading` starts well after the pick's reply.
    const chain = /^\/chain(\d)/.exec(request.url);
    if (chain) {
      const page = () => (response.writeHead(200, { "content-type": "text/html" }), response.end(`<!doctype html><title>chain${chain[1]}</title><p><a href="/chain${Number(chain[1]) + 1}">next</a></p>`));
      return void setTimeout(page, chain[1] === "2" ? 1200 : 0);
    }
    setTimeout(() => (response.writeHead(204), response.end()), 1500);
  });
  await new Promise((resolve) => slow_server.listen(0, "127.0.0.1", resolve));
  on_teardown(() => new Promise((resolve) => {
    for (const response of pending) response.destroy();
    slow_server.closeAllConnections();
    slow_server.close(resolve);
  }));
  const slow_url = (path) => `http://127.0.0.1:${slow_server.address().port}${path}`;

  await run_case("@a with a hint pick: the label picks, the macro goes on, and a key typed before the pick runs after the macro", async () => {
    await open_page("hints", "mr_pick", { new_tab: true });
    let mark = events.length;
    await press_keys("q", "a");
    await wait_event(mark, badge_is("mr_pick", "NORMAL recording @a"), "the recording badge after qa");
    await press_keys("F");
    await poll_until("the hint labels after F", async () => (await hint_label_count()) > 0);
    mark = events.length;
    await press_keys("s");
    await wait_event(mark, loaded("hint_two"), "the link to open in a background tab while recording");
    await press_keys("G");
    await poll_until("G to reach the bottom while recording", async () => (await scroll_y()) === (await bottom_y()));
    mark = events.length;
    await press_keys("q");
    await wait_event(mark, badge_is("mr_pick", "NORMAL"), "the plain badge after q");
    await close_tabs_with("hint_two");
    await settle_focus();
    await to_top();

    // k is typed right after @a, before the pick opens. Run then, it would scroll nothing at the top. Run after the macro's G, it moves up from the bottom.
    mark = events.length;
    await press_keys("@", "a", "k");
    await poll_until("the replayed pick to show its labels", async () => (await hint_label_count()) > 0);
    expect((await scroll_y()) === 0, "a step or the held k ran before the pick ended");
    await press_keys("s");
    await wait_event(mark, loaded("hint_two"), "the replayed pick to open its link");
    const bottom = await bottom_y();
    await poll_until("the held k to run after the macro's G", async () => {
      const y = await scroll_y();
      return y > 0 && y < bottom;
    });
    await close_tabs_with("hint_two");
  });

  await run_case("Escape in a replayed pick ends the macro and drops the key typed before it", async () => {
    await settle_focus();
    await to_top();
    await press_keys("@", "a", "G");
    await poll_until("the replayed pick to show its labels", async () => (await hint_label_count()) > 0);
    await press_keys("-k", "Escape");
    await poll_until("the labels to go after Escape", async () => (await hint_label_count()) === 0);
    await barrier("mr_pick");
    await sleep(300);
    expect((await scroll_y()) === 0, "the macro's G or the held G ran after Escape");
    // The hold ended, so a new key runs at once.
    await press_keys("j");
    await poll_until("j to scroll after the replay ended", async () => (await scroll_y()) > 0);
    await close_tabs_with("mr_pick");
  });

  await run_case("while another macro records, Escape at a replayed pick ends the pick and the replay, and q then stops", async () => {
    await open_page("hints", "mr_rec", { new_tab: true });
    let mark = events.length;
    await press_keys("q", "b");
    await wait_event(mark, badge_is("mr_rec", "NORMAL recording @b"), "the recording badge after qb");
    await press_keys("@", "a");
    await poll_until("the replayed pick to show its labels", async () => (await hint_label_count()) > 0);
    await press_keys("-k", "Escape");
    await poll_until("the labels to go after Escape", async () => (await hint_label_count()) === 0);
    mark = events.length;
    await press_keys("q");
    await wait_event(mark, badge_is("mr_rec", "NORMAL"), "the plain badge after q");
    expect((await scroll_y()) === 0, "the macro's G ran after Escape");
    await close_tabs_with("mr_rec");
  });

  await run_case("a replayed pick that follows a link in the same tab waits for the new page before the next step", async () => {
    await open_page("hints", "mr_follow", { new_tab: true });
    let mark = events.length;
    await press_keys("q", "c");
    await wait_event(mark, badge_is("mr_follow", "NORMAL recording @c"), "the recording badge after qc");
    await press_keys("f");
    await poll_until("the hint labels after f", async () => (await hint_label_count()) > 0);
    mark = events.length;
    await press_keys("a");
    await wait_event(mark, loaded("hint_one"), "the link to load in this tab while recording");
    await settle_focus();
    await press_keys("G");
    await poll_until("G to reach the bottom while recording", async () => (await scroll_y()) === (await bottom_y()));
    mark = events.length;
    await press_keys("q");
    await wait_event(mark, badge_is("hint_one", "NORMAL"), "the plain badge after q");
    await open_page("hints", "mr_follow", { new_tab: false });
    mark = events.length;
    await press_keys("@", "c");
    await poll_until("the replayed pick to show its labels", async () => (await hint_label_count()) > 0);
    await press_keys("a");
    await wait_event(mark, loaded("hint_one"), "the replayed pick to load the link in this tab");
    await poll_until("the macro's G to scroll the new page", async () => (await scroll_y()) > 0 && (await scroll_y()) === (await bottom_y()));
    await close_tabs_with("hint_one");
  });

  await run_case("Escape during a page-ready wait stops the replay and drops the key typed during it", async () => {
    await open_page("aligned", "mr_wait", { new_tab: true });
    await store_macro("w", [{ id: "open.url", args: { url: slow_url("/hang"), where: "here" } }, { id: "scroll.to", args: { percent: 100 } }]);
    await press_keys("@", "w");
    await poll_until("the tab to start loading the page that never answers", async () => (await active_tab_status()) === "loading");
    // The old page stays while the new one waits, and the replay holds its keys.
    await press_keys("j");
    await sleep(200);
    expect((await scroll_y()) === 0, "j ran during the page-ready wait");
    await press_keys("-k", "Escape");
    await barrier("mr_wait");
    await sleep(300);
    expect((await scroll_y()) === 0, "the macro's scroll.to or the held j ran after Escape");
    await press_keys("j");
    await poll_until("j to scroll after Escape ended the replay", async () => (await scroll_y()) > 0);
    await close_tabs_with("mr_wait");
  });

  await run_case("a tab-switching step holds the new tab's keys, which run after the macro ends", async () => {
    await open_page("aligned", "mr_from", { new_tab: true });
    await open_page("aligned", "mr_to", { new_tab: true });
    await to_top();
    await press_keys("gT");
    await wait_active_tab("mr_from");
    await settle_focus();
    // After the switch the 204 load keeps the replay waiting in the new tab, and G ends it there.
    await store_macro("t", [{ id: "tab.next" }, { id: "open.url", args: { url: slow_url("/nothing"), where: "here" } }, { id: "scroll.to", args: { percent: 100 } }]);
    await press_keys("@", "t");
    await wait_active_tab("mr_to", "the macro to switch to mr_to");
    await poll_until("the new tab to start its slow load", async () => (await active_tab_status()) === "loading");
    await press_keys("k");
    await sleep(200);
    expect((await scroll_y()) === 0, "a step after the load or the held k ran during the wait");
    const bottom = await bottom_y();
    await poll_until("the held k to run after the macro's G", async () => {
      const y = await scroll_y();
      return y > 0 && y < bottom;
    }, { timeout_ms: 8000 });
    await close_tabs_with("mr_from");
    await close_tabs_with("mr_to");
  });

  await run_case("2@d plays the macro twice, @@ plays it once more, and 5@d typed while recording is stored as one step with its count", async () => {
    await open_page("aligned", "mr_count", { new_tab: true });
    let mark = events.length;
    await press_keys("q", "d");
    await wait_event(mark, badge_is("mr_count", "NORMAL recording @d"), "the recording badge after qd");
    await press_keys("j");
    await poll_until("j to scroll while recording", async () => (await scroll_y()) > 0);
    await sleep(400);
    const one_step = await scroll_y();
    mark = events.length;
    await press_keys("q");
    await wait_event(mark, badge_is("mr_count", "NORMAL"), "the plain badge after q");
    await to_top();
    await press_keys("2", "@", "d");
    await poll_until("the two runs of the macro to scroll", async () => (await scroll_y()) === 2 * one_step);
    await sleep(300);
    expect((await scroll_y()) === 2 * one_step, "2@d scrolled other than twice");
    await press_keys("@", "@");
    await poll_until("@@ to play the macro once more", async () => (await scroll_y()) === 3 * one_step);

    mark = events.length;
    await press_keys("q", "e");
    await wait_event(mark, badge_is("mr_count", "NORMAL recording @e"), "the recording badge after qe");
    await press_keys("5", "@", "d");
    await poll_until("the five runs to finish", async () => (await scroll_y()) === 8 * one_step);
    await sleep(300);
    mark = events.length;
    await press_keys("q");
    await wait_event(mark, badge_is("mr_count", "NORMAL"), "the plain badge after the second q");
    const stored = JSON.parse(await in_background(`browser.storage.local.get("desertfox_register_e").then((items) => JSON.stringify(items.desertfox_register_e))`));
    expect(stored.length === 1 && stored[0].id === "macro.play" && stored[0].count === 5 && stored[0].args.reg === "d", `5@d was stored as ${JSON.stringify(stored)}`);
    await close_tabs_with("mr_count");
  });

  await run_case("a replayed pick that loads a slow page waits for it, so the next pick shows its labels on the new page", async () => {
    await open_page("aligned", "mr_chain", { new_tab: true });
    await store_macro("m", [{ id: "hint.run" }, { id: "hint.run" }]);
    const path_of_tab = () => in_background(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => new URL(tab.url).pathname)`);
    const script_ready = () => in_active_tab(`document.documentElement.hasAttribute("data-desertfox-tree-read-ms")`).catch(() => false);
    await in_background(`browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => browser.tabs.update(tab.id, { url: ${JSON.stringify(slow_url("/chain1"))} }))`);
    await poll_until("the first chain page", async () => (await path_of_tab()) === "/chain1" && (await script_ready()));
    await sleep(500);
    await press_keys("@", "m");
    await poll_until("the replayed pick to show its labels", async () => (await hint_label_count()) > 0);
    await press_keys("a");
    await poll_until("the second replayed pick to show labels on the slow page", async () => (await path_of_tab()) === "/chain2" && (await hint_label_count().catch(() => 0)) > 0);
    await press_keys("a");
    await poll_until("the second pick to load the last page", async () => (await path_of_tab()) === "/chain3");
    await close_tabs_with("mr_chain");
  });
}
