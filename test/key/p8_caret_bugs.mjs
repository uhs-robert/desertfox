// Repro cases for two caret mode bugs: j/k getting stuck, and the caret not starting at a find match.
export async function run_cases({ run_case, expect, open_page, send_keys, sleep, events, wait_event }) {
  const selections_of = (page_id) => events.filter((event) => event.type === "selection" && event.page_id === page_id && event.text !== "");

  // V starts on the title. Press a key n times and read the character under the caret ("" on an empty line, where no caret is drawn).
  async function caret_after(id, keys, after_g) {
    await send_keys("V");
    if (after_g) await send_keys("G");
    await sleep(300);
    for (const key of keys) {
      await send_keys(key);
      await sleep(250);
    }
    return events.filter((event) => event.type === "selection" && event.page_id === id).at(-1)?.text;
  }

  async function check(kind, keys, expected, after_g = false) {
    const id = `lines_${kind}`;
    await open_page("caret_bug_lines", id, { new_tab: true });
    const got = await caret_after(id, keys, after_g);
    await send_keys("-k", "Escape");
    expect(got === expected, `after ${keys.join("")} the caret is on ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
  }

  await run_case("j never sticks across blocks", () => check("blocks", ["j", "j", "j", "j"], "s"));
  await run_case("j passes an empty line made with br (a, empty, d)", () => check("empty_line", ["j", "j", "j"], "d"));
  await run_case("j passes two empty lines made with br (d, empty, empty, g)", () => check("empty_line", ["j", "j", "j", "j", "j", "j"], "g"));
  await run_case("j never sticks across links and inline elements", () => check("links", ["j", "j", "j"], "l"));
  await run_case("j passes a blank line in pre (a, empty, d)", () => check("pre", ["j", "j", "j"], "d"));
  await run_case("j passes a blank line in pre (g line, empty, j)", () => check("pre", ["j", "j", "j", "j", "j", "j"], "j"));
  await run_case("j never sticks across list items", () => check("lists", ["j", "j", "j", "j"], "t"));
  await run_case("j never sticks across wrapped blocks", () => check("wrapped_blocks", ["j", "j", "j", "j"], "g"));
  await run_case("k passes two empty lines made with br (g, empty, empty, d)", () => check("empty_line", ["k", "k", "k"], "d", true));
  await run_case("k passes a blank line in pre (j, empty, g line)", () => check("pre", ["k", "k"], " ", true));

  // Firefox's own quick find answers "/". After Enter and Escape its match stays selected on the page.
  await run_case("V after a find with / starts at the found match", async () => {
    await open_page("caret_bug_find", "find_a", { new_tab: true });
    await send_keys("/");
    await send_keys("-d", "30", "needle");
    await send_keys("-k", "Return");
    await send_keys("-k", "Escape");
    await sleep(500);
    const mark = events.length;
    await send_keys("V");
    await sleep(500);
    const shown = events.slice(mark).filter((event) => event.type === "selection" && event.page_id === "find_a" && event.text !== "").at(-1);
    expect(shown, "V drew no caret");
    expect(shown.text === "n", `the caret is on "${shown.text}", expected "n" of needle`);
    const mark_w = events.length;
    await send_keys("w");
    await wait_event(mark_w, (event) => event.type === "selection" && event.page_id === "find_a" && event.text === "s", "w to the word after the match");
    await send_keys("-k", "Escape");
  });

  await run_case("V after a find with / and no Escape on the find bar starts at the match", async () => {
    await open_page("caret_bug_find", "find_b", { new_tab: true });
    await send_keys("/");
    await send_keys("-d", "30", "needle");
    await send_keys("-k", "Return");
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    await sleep(500);
    const mark = events.length;
    await send_keys("V");
    await sleep(500);
    const shown = events.slice(mark).filter((event) => event.type === "selection" && event.page_id === "find_b" && event.text !== "").at(-1);
    expect(shown && shown.text === "n", `the caret is on "${shown?.text}", expected "n" of needle`);
    await send_keys("-k", "Escape");
  });

  // In caret mode "/" is not bound, so Firefox's quick find runs and moves the page selection under the session.
  await run_case("a find with / inside caret mode leaves the caret at the match for w", async () => {
    await open_page("caret_bug_find", "find_c", { new_tab: true });
    await send_keys("V");
    await sleep(300);
    await send_keys("/");
    await send_keys("-d", "30", "needle");
    await send_keys("-k", "Return");
    await sleep(500);
    const mark = events.length;
    await send_keys("w");
    await sleep(600);
    const shown = events.slice(mark).filter((event) => event.type === "selection" && event.page_id === "find_c" && event.text !== "").at(-1);
    expect(shown && shown.text === "s", `after w the caret is on "${shown?.text}", expected "s" (the word after needle)`);
    await send_keys("-k", "Escape");
  });

  await run_case("j in visual mode passes two br empty lines (d, empty, empty, g)", async () => {
    await open_page("caret_bug_lines", "lines_empty_line", { new_tab: true });
    await send_keys("V");
    await send_keys("v");
    for (let step = 0; step < 6; step++) {
      await send_keys("j");
      await sleep(250);
    }
    const text = events.filter((event) => event.type === "selection" && event.page_id === "lines_empty_line").at(-1)?.text ?? "";
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    expect(text.trimEnd().endsWith("g"), `after v and 6 j the selection ends ${JSON.stringify(text.slice(-8))}, expected it to end on "g"`);
  });
}
