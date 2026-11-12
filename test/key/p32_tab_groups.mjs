// Key test cases of the tg keys (native tab groups) and the groups completion. run.mjs calls run_cases with its helpers.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["tabs", "cmdline", "keys"];

export async function run_cases({ rdp, extension_id, run_case, setup, press_keys, open_page, wait_cmdline, complete_in_line, poll_until, settle_focus, expect, type_in_line }) {
  const background = (code) => evaluate_in_background(rdp, extension_id, code);
  const active = () => background(`(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return { id: tab.id, group_id: tab.groupId, pinned: tab.pinned }; })()`);
  // A tab in no group answers `{ id: -1 }`, because the debugger client does not carry undefined.
  const group_of = (id) => background(`(async () => { const tab = await browser.tabs.get(${id}); return tab.groupId === -1 ? { id: -1 } : browser.tabGroups.get(tab.groupId); })()`);
  // The key goes to the background, so a case polls until its effect shows.
  const wait_group = (id, what, check) => poll_until(what, async () => check(await group_of(id)));
  const submit_line = async (text) => {
    await wait_cmdline((line) => line.ready, "the command line to open");
    await type_in_line(text);
    await press_keys("-k", "Return");
  };

  await setup("open the first group page", () => open_page("page", "p31_one", { new_tab: true }));
  let first;

  // Measured: without the manifest permission "tabGroups" the API is absent, so a build that drops it fails here.
  await run_case("the tabGroups API is there with the manifest permission", async () => {
    expect((await background(`typeof browser.tabGroups.query`)) === "function", "browser.tabGroups.query is missing");
  });

  await run_case("tgA puts the tab in a new untitled group", async () => {
    first = (await active()).id;
    await press_keys("tgA");
    await wait_group(first, "the tab to join a group", (group) => group.id !== -1);
    expect((await group_of(first)).title === "", "the new group has a title");
  });

  await run_case("tgn names the group from the command line", async () => {
    await press_keys("tgn");
    await submit_line("Work");
    await wait_group(first, "the group to be named Work", (group) => group.title === "Work");
  });

  await run_case("tgc collapses the group, tge expands it, tgt toggles it", async () => {
    await press_keys("tgc");
    await wait_group(first, "the group to collapse", (group) => group.collapsed === true);
    await press_keys("tge");
    await wait_group(first, "the group to expand", (group) => group.collapsed === false);
    await press_keys("tgt");
    await wait_group(first, "the toggle to collapse", (group) => group.collapsed === true);
    await press_keys("tgt");
    await wait_group(first, "the toggle to expand", (group) => group.collapsed === false);
  });

  await run_case("tga lists the group by title and a pick joins a second tab to it", async () => {
    await open_page("page", "p31_two", { new_tab: true });
    const second = (await active()).id;
    await settle_focus();
    await press_keys("tga");
    await wait_cmdline((line) => line.ready, "the command line to open");
    await type_in_line("Wor", { until: (line) => line.row_texts.some((row) => row.includes("Work")) });
    await complete_in_line();
    await press_keys("-k", "Return");
    await wait_group(second, "the second tab to join Work", (group) => group.title === "Work");
    expect((await group_of(second)).id === (await group_of(first)).id, "the tab joined another group");
  });

  await run_case("a pinned tab is refused, and the next unpinned tab still groups", async () => {
    await open_page("page", "p31_pin", { new_tab: true });
    const pinned = (await active()).id;
    await background(`browser.tabs.update(${pinned}, { pinned: true })`);
    await settle_focus();
    await press_keys("tgA");
    await open_page("page", "p31_after", { new_tab: true });
    const after = (await active()).id;
    await settle_focus();
    await press_keys("tgA");
    await wait_group(after, "the unpinned tab to group", (group) => group.id !== -1);
    expect((await group_of(pinned)).id === -1, "the pinned tab joined a group");
    await background(`browser.tabs.update(${pinned}, { pinned: false })`);
  });

  await run_case("tgd takes the tab out of its group", async () => {
    await settle_focus();
    await press_keys("tgd");
    const { id } = await active();
    await wait_group(id, "the tab to leave its group", (group) => group.id === -1);
  });

  await run_case("tg with a tab in no group does nothing and the keys keep working", async () => {
    await press_keys("tgc");
    await press_keys("tgA");
    const { id } = await active();
    await wait_group(id, "the tab to group after the refused tgc", (group) => group.id !== -1);
  });
}
