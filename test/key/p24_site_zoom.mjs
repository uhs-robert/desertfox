// The `zoom` column of the site table: the first tab on the site gets its level, and a manual zoom after it survives a reload, another page of the site and a new tab on it.
// The row sits in config/settings.toml. Firefox remembers zoom per host and every test page is on 127.0.0.1, so the teardown puts that memory back to 100 percent.

export const areas = ["scroll", "config"];

// The background zooms on the load's first update, well before the page reads its keymap. This margin covers a set that would come late.
const LATE_ZOOM_MS = 300;

export async function run_cases({ run_case, open_page, press_keys, poll_until, in_background, on_teardown, events, wait_event, expect, sleep }) {
  const active_tab_id = () => in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab.id)`);
  const zoom_of = (tab_id) => in_background(`browser.tabs.getZoom(${tab_id})`);
  const wait_zoom = (tab_id, level, what) => poll_until(what, async () => (await zoom_of(tab_id)) === level).catch(async (error) => { throw new Error(`${error.message}, zoom ${await zoom_of(tab_id)}`); });
  on_teardown(() => in_background(`browser.tabs.query({ url: "*://127.0.0.1/*" }).then((tabs) => Promise.all(tabs.map((tab) => browser.tabs.setZoom(tab.id, 1))))`));

  await run_case("a site row zooms the first tab, and a manual zoom then survives a reload, another page of the site and a new tab", async () => {
    await open_page("page", "zoom_site", { new_tab: true });
    const tab_id = await active_tab_id();
    await wait_zoom(tab_id, 1.5, "the site row's 150 percent");
    await press_keys("-M", "ctrl", "-k", "minus", "-m", "ctrl");
    await poll_until("Ctrl+minus to zoom out", async () => (await zoom_of(tab_id)) < 1.5);
    const manual_level = await zoom_of(tab_id);
    const mark = events.length;
    await in_background(`browser.tabs.reload(${tab_id})`);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "zoom_site", "the reloaded page");
    await sleep(LATE_ZOOM_MS);
    expect((await zoom_of(tab_id)) === manual_level, `the reload set the zoom again: ${await zoom_of(tab_id)}, manual ${manual_level}`);
    await open_page("page", "zoom_site_next", { new_tab: false });
    await sleep(LATE_ZOOM_MS);
    expect((await zoom_of(tab_id)) === manual_level, `another page of the site set the zoom again: ${await zoom_of(tab_id)}, manual ${manual_level}`);
    await open_page("page", "zoom_site_new_tab", { new_tab: true });
    const new_tab_id = await active_tab_id();
    await sleep(LATE_ZOOM_MS);
    expect((await zoom_of(new_tab_id)) === manual_level, `a new tab on the site set the zoom again: ${await zoom_of(new_tab_id)}, manual ${manual_level}`);
  });
}
