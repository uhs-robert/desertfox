import { evaluate_in_background } from "./rdp.mjs";

// Repro cases for two caret mode bugs: j/k getting stuck, and the caret not starting at a find match.
export async function run_cases({ run_case, expect, open_page, send_keys, sleep, events, wait_event, rdp, extension_id }) {
  const selections_of = (page_id) => events.filter((event) => event.type === "selection" && event.page_id === page_id && event.text !== "");

  // V starts on the title. Press a key n times and read the character under the caret ("" on an empty line, where no caret is drawn).
  async function caret_after(id, keys, after_g) {
    await send_keys("gV");
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

  // Something else selects the match, as a find does: `window.find`, because "/" is page search in normal mode and leaves the page selection alone.
  const select_needle = () => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.executeScript(tab.id, { code: 'window.find("needle")' }); })()`);
  await run_case("V after a find selected the match starts at it", async () => {
    await open_page("caret_bug_find", "find_a", { new_tab: true });
    await select_needle();
    await sleep(500);
    const mark = events.length;
    await send_keys("gV");
    await sleep(500);
    const shown = events.slice(mark).filter((event) => event.type === "selection" && event.page_id === "find_a" && event.text !== "").at(-1);
    expect(shown, "V drew no caret");
    expect(shown.text === "n", `the caret is on "${shown.text}", expected "n" of needle`);
    const mark_w = events.length;
    await send_keys("w");
    await wait_event(mark_w, (event) => event.type === "selection" && event.page_id === "find_a" && event.text === "s", "w to the word after the match");
    await send_keys("-k", "Escape");
  });

  // In caret mode "/" is not bound, so Firefox's quick find runs and moves the page selection under the session.
  await run_case("a find with / inside caret mode leaves the caret at the match for w", async () => {
    await open_page("caret_bug_find", "find_c", { new_tab: true });
    await send_keys("gV");
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
    await send_keys("gV");
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

  // Decision 3: visual mode keeps the anchor and moves the caret to the end of the match.
  await run_case("a find with / in visual mode keeps the anchor and ends on the first character of the match", async () => {
    await open_page("caret_bug_find", "find_d", { new_tab: true });
    await send_keys("gV");
    await send_keys("v");
    await sleep(300);
    await send_keys("/");
    await send_keys("-d", "30", "needle");
    await send_keys("-k", "Return");
    await sleep(500);
    // o swaps the ends, which makes the session adopt the find first. The selected text is the same either way.
    await send_keys("o");
    await sleep(600);
    const text = events.filter((event) => event.type === "selection" && event.page_id === "find_d").at(-1)?.text ?? "";
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    expect(text.startsWith("caret_bug_find") && text.trimEnd().endsWith("n") && !text.trimEnd().endsWith("needle"), `the selection is ${JSON.stringify(text.slice(0, 20))}...${JSON.stringify(text.slice(-12))}, expected from the title to the "n" of "needle"`);
  });

  // A drag in the page can end at offset 0 of a later text node. The span then ends at the character before it, not at its start.
  await run_case("a page selection ending at offset 0 of the next block keeps the whole span", async () => {
    await open_page("caret_bug_lines", "lines_blocks", { new_tab: true });
    await send_keys("gV");
    await send_keys("v");
    await sleep(300);
    await evaluate_in_background(rdp, extension_id, `(async () => {
      const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      await browser.tabs.executeScript(tab.id, { code: "(() => { const paragraphs = document.querySelectorAll('p'); const range = document.createRange(); range.setStart(paragraphs[0].firstChild, 2); range.setEnd(paragraphs[1].firstChild, 0); getSelection().removeAllRanges(); getSelection().addRange(range); })()" });
    })()`);
    await sleep(300);
    await send_keys("o");
    await sleep(600);
    const text = events.filter((event) => event.type === "selection" && event.page_id === "lines_blocks").at(-1)?.text ?? "";
    await send_keys("-k", "Escape");
    await send_keys("-k", "Escape");
    // The caret rests on the line end after "two", which paints no character, so the text stops before "o". The unfixed code stopped at "one".
    expect(text.endsWith("one tw"), `the selection ends ${JSON.stringify(text.slice(-10))}, expected it to end with "one tw"`);
  });

  // Focus entering a field in caret or visual mode must switch to insert, so motion keys do not swallow typing.
  const in_active_tab = (code) => evaluate_in_background(rdp, extension_id, `(async () => { const [tab] = await browser.tabs.query({ active: true, currentWindow: true }); return browser.tabs.executeScript(tab.id, { code: ${JSON.stringify(code)} }); })()`);
  const badge_is = (page_id, label) => (event) => event.type === "indicator" && event.page_id === page_id && event.label === label;
  for (const kind of ["caret", "visual"]) {
    await run_case(`focusing a field in ${kind} mode switches to insert and typing reaches the field`, async () => {
      const page_id = `focus_${kind}`;
      await open_page("caret", page_id, { new_tab: true });
      await send_keys("gV");
      if (kind === "visual") await send_keys("v");
      await wait_event(0, badge_is(page_id, kind === "visual" ? "VISUAL" : "CARET"), `the ${kind} badge`);
      const mark = events.length;
      await in_active_tab("document.getElementById('paste_target').focus()");
      await wait_event(mark, badge_is(page_id, "INSERT"), "the INSERT badge after the field took focus");
      await send_keys("jv");
      await wait_event(mark, (event) => event.type === "input" && event.page_id === page_id && event.value === "jv", "the field to hold jv");
      const state = JSON.parse((await in_active_tab("JSON.stringify({ active: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd })"))[0]);
      expect(state.active === "paste_target" && state.start === 2 && state.end === 2, `the field lost its caret: ${JSON.stringify(state)}`);
      const mark_escape = events.length;
      await send_keys("-k", "Escape");
      await wait_event(mark_escape, badge_is(page_id, "NORMAL"), "the NORMAL badge after Escape");
    });
  }

  // A contenteditable field uses the document selection as its caret, so ending the caret session must not clear it.
  await run_case("focusing a contenteditable field in caret mode keeps its caret and typing lands there", async () => {
    const page_id = "focus_editable";
    await open_page("caret_editable", page_id, { new_tab: true });
    await send_keys("gV");
    await wait_event(0, badge_is(page_id, "CARET"), "the CARET badge");
    const mark = events.length;
    await in_active_tab("(() => { const field = document.getElementById('editable'); const range = document.createRange(); range.setStart(field.firstChild, 5); range.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); field.focus(); })()");
    await wait_event(mark, badge_is(page_id, "INSERT"), "the INSERT badge after the field took focus");
    await sleep(300);
    await send_keys("jv");
    await sleep(500);
    const text = (await in_active_tab("document.getElementById('editable').textContent"))[0];
    await send_keys("-k", "Escape");
    expect(text === "hellojv world", `the field holds ${JSON.stringify(text)}, expected "hellojv world"`);
  });
}
