// Key cases of the caret and visual piece. run.mjs calls run_cases with its helpers.

export async function run_cases({ run_case, expect, open_page, send_keys, sleep, events, wait_event }) {
  const paste_ctrl_v = ["-M", "ctrl", "v", "-m", "ctrl"];

  // The page text is "caret p7", "foo bar.baz", "second line here". From the first word, 3w lands on "bar".
  await run_case("V, 3w, v, e, y copies the word the selection reached", async () => {
    await open_page("caret", "caret_yank", { new_tab: true });
    await send_keys("V");
    await send_keys("3w");
    await send_keys("v");
    await send_keys("e");
    await send_keys("y");
    await sleep(300);
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    const mark = events.length;
    const badges = events.filter((event) => event.type === "indicator" && event.page_id === "caret_yank").map((event) => event.label).join(",");
    await send_keys("gi");
    await send_keys(...paste_ctrl_v);
    const pasted = await wait_event(mark, (event) => event.type === "input" && event.page_id === "caret_yank", `the pasted text (badges ${badges})`);
    expect(pasted.value === "bar", `y copied "${pasted.value}", expected "bar"`);
  });
}
