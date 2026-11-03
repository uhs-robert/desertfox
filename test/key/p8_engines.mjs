// Key test cases of the engines piece. run.mjs calls run_cases with its helpers.
// The test page has a host but is not a GitHub repo or a subreddit, so `{host}` engines are available there and `{repo}` ones are not.
// The engines and the sh, sr, sf keys come from run.mjs and config/keymap.d/70-engines.toml.

export async function run_cases({ run_case, send_keys, open_page, wait_event, find_event, events, expect, sleep }) {
  const panel_event = () => (event) => event.type === "whichkey" && event.page_id === "eng" && event.value !== "";
  const loaded = (page_id) => (event) => event.type === "tree_read" && event.page_id === page_id;

  await open_page("page", "eng", { new_tab: true });

  await run_case("the s panel lists the keys the page can run: the host key and the fallback key show, the repo key is hidden", async () => {
    const mark = events.length;
    await send_keys("s");
    const shown = await wait_event(mark, panel_event(), "the s panel");
    // sq, sh and sf. Without the filter the panel would also list sr.
    expect(/:3$/.test(shown.value), `the panel reported "${shown.value}", expected 3 rows`);
    await send_keys("-k", "Escape");
    await sleep(400);
  });

  await run_case("s/ is no longer bound", async () => {
    const mark = events.length;
    await send_keys("s/");
    await sleep(900);
    expect(!find_event(mark, (event) => event.type === "toast" || event.type === "whichkey" && event.value !== ""), "s/ did something");
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
