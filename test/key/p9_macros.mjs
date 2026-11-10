// Macro recording: q<reg> starts, the badge says so in the page, q again stops and stores the steps in the register, and qA adds to a stored macro.

export const areas = ["keys", "whichkey"];

export async function run_cases({ run_case, open_page, poll_until, press_keys, wait_event, events, in_active_tab, badge_is, settle_focus }) {
  const read_register = (name) => in_active_tab(`browser.runtime.sendMessage({ type: "register_read", name: ${JSON.stringify(name)} })`);
  const ids_of = async (name) => (await read_register(name))?.map?.((step) => step.id);

  await run_case("qa shows the recording badge, and q stops it and stores the keys pressed between", async () => {
    await open_page("page", "p9mac_one", { new_tab: true });
    await settle_focus();
    let mark = events.length;
    await press_keys("q", "a");
    await wait_event(mark, badge_is("p9mac_one", "NORMAL recording @a"), "the recording badge after qa");
    await press_keys("j", "G", "k");
    mark = events.length;
    await press_keys("q");
    await wait_event(mark, badge_is("p9mac_one", "NORMAL"), "the plain badge after q");
    await poll_until("register a to hold the two scrolls", async () => JSON.stringify(await ids_of("a")) === JSON.stringify(["scroll.lines", "scroll.to", "scroll.lines"]));
  });

  await run_case("qA adds to macro a, and q q stores an empty macro", async () => {
    await press_keys("q", "A", "j", "q");
    await poll_until("register a to hold three scrolls", async () => (await ids_of("a"))?.length === 3);
    // The stop key arrives with the tree that the badge comes from, so q waits for the badge.
    const mark = events.length;
    await press_keys("q", "b");
    await wait_event(mark, badge_is("p9mac_one", "NORMAL recording @b"), "the recording badge after qb");
    await press_keys("q");
    await poll_until("register b to hold an empty macro", async () => JSON.stringify(await read_register("b")) === "[]");
  });
}
