// Key test cases of the engines piece. run.mjs calls run_cases with its helpers.
// The test page has a host but is not a GitHub repo or a subreddit, so `{host}` engines are available there and `{repo}` ones are not.
// The engines and the sd, sh, sr, sf, sp keys come from run.mjs and config/keymap.d/70-engines.toml. The s/ keys come from the 80-site.toml that run.mjs writes.

import { evaluate_in_background } from "./rdp.mjs";

export async function run_cases({ rdp, extension_id, run_case, send_keys, open_page, wait_event, find_event, events, expect, sleep }) {
  const panel_event = () => (event) => event.type === "whichkey" && event.page_id === "eng" && event.value !== "";
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;

  await open_page("page", "eng", { new_tab: true });

  await run_case("the s panel lists the keys the page can run: the host key and the fallback key show, the repo key is hidden", async () => {
    const mark = events.length;
    await send_keys("s");
    const shown = await wait_event(mark, panel_event(), "the s panel");
    // sd, sh, sf and sp, and the s/ group. Without the filter the panel would also list sr.
    expect(/:5$/.test(shown.value), `the panel reported "${shown.value}", expected 5 rows`);
    await send_keys("-k", "Escape");
    await sleep(400);
  });

  // Not Ctrl+A: that key is bound to url.increment, so it never selects the page text.
  const select_all = () => evaluate_in_background(rdp, extension_id, `(async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    await browser.tabs.executeScript(tab.id, { code: "getSelection().selectAllChildren(document.body)" });
  })()`);
  const tab_count = `(async () => (await browser.tabs.query({})).length)()`;

  await run_case("s/ lists the site search and the member whose host fits, and hides the member of another host", async () => {
    const mark = events.length;
    await send_keys("s/");
    const shown = await wait_event(mark, panel_event(), "the s/ panel");
    // The / key (s//) and h. Without the host gate the panel would also list n.
    expect(/:2$/.test(shown.value), `the panel reported "${shown.value}", expected 2 rows`);
    await send_keys("-k", "Escape");
    await sleep(400);
  });

  await run_case("a typed s/n on a host its engine does not serve refuses with a toast and opens nothing", async () => {
    await open_page("page", "eng_site_refuse", { new_tab: false });
    const mark = events.length;
    await send_keys("s/n");
    await wait_event(mark, (event) => event.type === "toast", "the refusal toast");
    expect(!find_event(mark, loaded("engine_other")), "the engine of another host opened a page");
  });

  await run_case("s// searches the current site with the selection", async () => {
    await open_page("page", "eng_site_sel", { new_tab: false });
    await select_all();
    const mark = events.length;
    await send_keys("s//");
    const result = await wait_event(mark, loaded("search_result"), "the site search page");
    expect(result.search.includes("q=site:127.0.0.1+"), `the page opened with ${result.search}`);
  });

  await run_case("s/h runs the engine of the page's host on the selection", async () => {
    await open_page("page", "eng_here_sel", { new_tab: false });
    await select_all();
    const mark = events.length;
    await send_keys("s/h");
    const result = await wait_event(mark, loaded("engine_here"), "the member engine page");
    expect(result.search.includes("q=127.0.0.1+") && decodeURIComponent(result.search).includes("eng_here_sel"), `the page opened with ${result.search}`);
  });

  await run_case("s/h with nothing selected opens the command line, and Enter runs the member", async () => {
    await open_page("page", "eng_here_empty", { new_tab: false });
    await send_keys("s/h");
    await sleep(800);
    const mark = events.length;
    await send_keys("hello", "-k", "Return");
    const result = await wait_event(mark, loaded("engine_here"), "the member engine page from the command line");
    expect(result.search.includes("q=127.0.0.1+hello"), `the page opened with ${result.search}`);
  });

  await run_case("S/h opens the member in a new tab", async () => {
    await open_page("page", "eng_here_tab", { new_tab: false });
    await select_all();
    const before = await evaluate_in_background(rdp, extension_id, tab_count);
    const mark = events.length;
    await send_keys("S/h");
    await wait_event(mark, loaded("engine_here"), "the member engine page in a new tab");
    const after = await evaluate_in_background(rdp, extension_id, tab_count);
    expect(after === before + 1, `tabs went from ${before} to ${after}`);
    expect(!find_event(mark, (event) => event.type === "tree_read" && event.page_id === "eng_here_tab"), "the source tab navigated");
  });

  await run_case("a key on a query-or-page engine searches the page address when nothing is selected", async () => {
    await open_page("page", "eng_page_start", { new_tab: false });
    const mark = events.length;
    await send_keys("sp");
    const result = await wait_event(mark, loaded("engine_page"), "the query-or-page engine page");
    expect(decodeURIComponent(result.search).includes("eng_page_start"), `the page opened with ${result.search}`);
  });

  await run_case("a key whose engine needs a repo shows the slot message and opens nothing", async () => {
    await open_page("page", "eng_repo_start", { new_tab: false });
    const mark = events.length;
    await send_keys("sr");
    await wait_event(mark, (event) => event.type === "toast", "the slot message toast");
    expect(!find_event(mark, loaded("engine_repo")), "the repo engine opened a page");
  });

  await run_case("a typed host engine fills the host slot and the query", async () => {
    await open_page("page", "eng_host_start", { new_tab: false });
    const mark = events.length;
    await send_keys(":search keysite hello", "-k", "Return");
    const result = await wait_event(mark, loaded("engine_site"), "the host engine page");
    expect(result.search.includes("q=127.0.0.1+hello"), `the page opened with ${result.search}`);
  });

  await run_case("an engine with a fallback uses it when the subreddit slot cannot fill", async () => {
    await open_page("page", "eng_sub_start", { new_tab: false });
    const mark = events.length;
    await send_keys(":search keysub fallback", "-k", "Return");
    const result = await wait_event(mark, loaded("search_result"), "the fallback engine page");
    expect(result.search.includes("q=fallback"), `the page opened with ${result.search}`);
  });

  await run_case("a search key on the selection with nothing selected opens the command line", async () => {
    await open_page("page", "eng_prompt", { new_tab: false });
    await send_keys("sh");
    await sleep(800);
    const mark = events.length;
    await send_keys("j");
    await sleep(500);
    expect(!find_event(mark, (event) => event.type === "scroll" && event.page_id === "eng_prompt"), "j scrolled the page while the line was open");
    await send_keys("-M", "ctrl", "u", "-m", "ctrl");
    await send_keys("-k", "Escape");
    await sleep(400);
  });
}
