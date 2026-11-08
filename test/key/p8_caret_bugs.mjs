import { evaluate_in_background } from "./rdp.mjs";

// Repro cases for two caret mode bugs: j/k getting stuck, and the caret not starting at a find match.
export const areas = ["caret", "find"];

export async function run_cases({ run_case, expect, open_page, press_keys, poll_until, barrier, wait_cmdline, events, wait_event, rdp, extension_id, in_active_tab, badge_is, is_selection_of, press_and_wait_for_move, escape_to_normal, settle_focus }) {
  const last_selection_text = (page_id) => events.filter((event) => event.type === "selection" && event.page_id === page_id && event.text !== "").at(-1)?.text;

  async function press_and_wait_for_badge(page_id, keys, label) {
    const mark = events.length;
    await press_keys(keys);
    await wait_event(mark, badge_is(page_id, label), `the ${label} badge after ${keys}`);
  }
  // The last selection report after the mark, once it passes `accept`. The timeout names that report, which tells a wrong caret from a missing one.
  async function wait_for_last_selection(page_id, mark, accept, what) {
    const last = () => events.slice(mark).filter(is_selection_of(page_id)).at(-1);
    try {
      await poll_until(what, () => last() && accept(last()));
    } catch (error) {
      throw new Error(`${error.message}, the last selection report is ${JSON.stringify(last())}`);
    }
    return last();
  }
  // Types a search into the line once it is open, presses Return and waits for the line to close.
  async function search_with_line(text) {
    await press_keys("/");
    await wait_cmdline((line) => line.open && line.focused, "the search line to open");
    await press_keys("-d", "30", text);
    await wait_cmdline((line) => line.open && line.value === text, `the search line to hold ${text}`);
    await press_keys("-k", "Return");
    await wait_cmdline((line) => !line.open, "the search line to close");
    // The line goes before the page has the focus back, and a key in between is lost.
    await settle_focus();
  }

  // V starts on the title. Press a key n times and read the character under the caret ("" on an empty line, where no caret is drawn).
  async function caret_after(id, keys, after_g) {
    let last = await press_and_wait_for_move(id, "gV", "the caret on the title");
    if (after_g) last = await press_and_wait_for_move(id, "G", "G to move the caret");
    for (const key of keys) last = await press_and_wait_for_move(id, key, `${key} to move the caret`);
    return last.text;
  }

  async function check(kind, keys, expected, after_g = false) {
    const id = `lines_${kind}`;
    await open_page("caret_bug_lines", id, { new_tab: true });
    const got = await caret_after(id, keys, after_g);
    expect(got === expected, `after ${keys.join("")} the caret is on ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    await escape_to_normal(id);
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
  await run_case("V after a find selected the match puts the caret on its last letter", async () => {
    await open_page("caret_bug_find", "find_a", { new_tab: true });
    const mark_find = events.length;
    await select_needle();
    await wait_event(mark_find, (event) => is_selection_of("find_a")(event) && event.text === "needle", "the find to select needle");
    const mark = events.length;
    await press_keys("gV");
    await wait_for_last_selection("find_a", mark, (last) => last.text === "e", 'V to put the caret on "e", the last letter of needle');
    const mark_w = events.length;
    await press_keys("w");
    await wait_event(mark_w, (event) => event.type === "selection" && event.page_id === "find_a" && event.text === "s", "w to the word after the match");
    await escape_to_normal("find_a");
  });

  // In caret mode "/" opens the DesertFox search line, and the match it finds moves the page selection under the session.
  await run_case("a find with / inside caret mode leaves the caret at the match for w", async () => {
    await open_page("caret_bug_find", "find_c", { new_tab: true });
    await press_and_wait_for_move("find_c", "gV", "the caret on the title");
    const mark_search = events.length;
    await search_with_line("needle");
    await wait_event(mark_search, is_selection_of("find_c"), "the caret at the match");
    const mark = events.length;
    await press_keys("w");
    await wait_for_last_selection("find_c", mark, (last) => last.text === "s", 'w to put the caret on "s" (the word after needle)');
    await escape_to_normal("find_c");
  });

  await run_case("j in visual mode passes two br empty lines (d, empty, empty, g)", async () => {
    await open_page("caret_bug_lines", "lines_empty_line", { new_tab: true });
    await press_and_wait_for_move("lines_empty_line", "gV", "the caret on the title");
    await press_and_wait_for_badge("lines_empty_line", "v", "VISUAL");
    // v reports the selection it starts from, and that report can come after the badge. So each j waits for a selection that differs from the one before it.
    let text = last_selection_text("lines_empty_line");
    for (let step = 0; step < 6; step++) {
      const mark = events.length;
      const previous = text;
      await press_keys("j");
      text = (await wait_event(mark, (event) => is_selection_of("lines_empty_line")(event) && event.text !== previous, `j number ${step + 1} to grow the selection`)).text;
    }
    expect(text.trimEnd().endsWith("g"), `after v and 6 j the selection ends ${JSON.stringify(text.slice(-8))}, expected it to end on "g"`);
    await escape_to_normal("lines_empty_line");
  });

  // Decision 3: visual mode keeps the anchor and moves the caret to the end of the match.
  await run_case("a find with / in visual mode keeps the anchor and ends on the first character of the match", async () => {
    await open_page("caret_bug_find", "find_d", { new_tab: true });
    await press_and_wait_for_move("find_d", "gV", "the caret on the title");
    await press_and_wait_for_badge("find_d", "v", "VISUAL");
    const mark_search = events.length;
    await search_with_line("needle");
    await wait_event(mark_search, is_selection_of("find_d"), "the selection to follow the match");
    // o swaps the ends, which makes the session adopt the find first. The selected text is the same either way, so o reports nothing and a barrier orders it before the read.
    await press_keys("o");
    await barrier("find_d");
    const text = events.filter(is_selection_of("find_d")).at(-1)?.text ?? "";
    expect(text.startsWith("caret_bug_find") && text.trimEnd().endsWith("n") && !text.trimEnd().endsWith("needle"), `the selection is ${JSON.stringify(text.slice(0, 20))}...${JSON.stringify(text.slice(-12))}, expected from the title to the "n" of "needle"`);
    await escape_to_normal("find_d");
  });

  // A drag in the page can end at offset 0 of a later text node. The span then ends at the character before it, not at its start.
  await run_case("a page selection ending at offset 0 of the next block keeps the whole span", async () => {
    await open_page("caret_bug_lines", "lines_blocks", { new_tab: true });
    await press_and_wait_for_move("lines_blocks", "gV", "the caret on the title");
    await press_and_wait_for_badge("lines_blocks", "v", "VISUAL");
    const mark_drag = events.length;
    await evaluate_in_background(rdp, extension_id, `(async () => {
      const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      await browser.tabs.executeScript(tab.id, { code: "(() => { const paragraphs = document.querySelectorAll('p'); const range = document.createRange(); range.setStart(paragraphs[0].firstChild, 2); range.setEnd(paragraphs[1].firstChild, 0); getSelection().removeAllRanges(); getSelection().addRange(range); })()" });
    })()`);
    await wait_event(mark_drag, is_selection_of("lines_blocks"), "the page selection to be reported");
    await press_keys("o");
    // Visual mode takes the drag whole, so it starts at the drag's start. The caret rests on the line end after "two", which paints no character, so the text stops before "o". The unfixed code stopped at "one".
    await wait_for_last_selection("lines_blocks", mark_drag, (last) => last.text === "e tw", 'the selection "e tw" after o');
    await escape_to_normal("lines_blocks");
  });

  // Focus entering a field in caret or visual mode must switch to insert, so motion keys do not swallow typing.
  for (const kind of ["caret", "visual"]) {
    await run_case(`focusing a field in ${kind} mode switches to insert and typing reaches the field`, async () => {
      const page_id = `focus_${kind}`;
      await open_page("caret", page_id, { new_tab: true });
      await press_and_wait_for_move(page_id, "gV", "the caret");
      if (kind === "visual") await press_and_wait_for_badge(page_id, "v", "VISUAL");
      const mark = events.length;
      await in_active_tab("document.getElementById('paste_target').focus()");
      await wait_event(mark, badge_is(page_id, "INSERT"), "the INSERT badge after the field took focus");
      await press_keys("jv");
      await wait_event(mark, (event) => event.type === "input" && event.page_id === page_id && event.value === "jv", "the field to hold jv");
      const state = JSON.parse(await in_active_tab("JSON.stringify({ active: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd })"));
      expect(state.active === "paste_target" && state.start === 2 && state.end === 2, `the field lost its caret: ${JSON.stringify(state)}`);
      const mark_escape = events.length;
      await press_keys("-k", "Escape");
      await wait_event(mark_escape, badge_is(page_id, "NORMAL"), "the NORMAL badge after Escape");
    });
  }

  // The typed keys reach the field after the badge, and nothing reports them, so the field's text is polled. The last text read is returned either way, for the case's own message.
  async function wait_for_field_text(field_expression) {
    let text;
    await poll_until("the field to hold the typed keys", async () => (text = await in_active_tab(`${field_expression}.textContent`)) === "hellojv world").catch(() => undefined);
    return text;
  }

  // A contenteditable field uses the document selection as its caret, so ending the caret session must not clear it.
  await run_case("focusing a contenteditable field in caret mode keeps its caret and typing lands there", async () => {
    const page_id = "focus_editable";
    await open_page("caret_editable", page_id, { new_tab: true });
    await press_and_wait_for_badge(page_id, "gV", "CARET");
    const mark = events.length;
    await in_active_tab("(() => { const field = document.getElementById('editable'); const range = document.createRange(); range.setStart(field.firstChild, 5); range.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); field.focus(); })()");
    await wait_event(mark, badge_is(page_id, "INSERT"), "the INSERT badge after the field took focus");
    await press_keys("jv");
    const text = await wait_for_field_text("document.getElementById('editable')");
    expect(text === "hellojv world", `the field holds ${JSON.stringify(text)}, expected "hellojv world"`);
    await escape_to_normal(page_id);
  });

  await run_case("focusing a contenteditable field in an open shadow root keeps its caret", async () => {
    const page_id = "focus_editable_shadow";
    await open_page("caret_editable_shadow", page_id, { new_tab: true });
    await press_and_wait_for_badge(page_id, "gV", "CARET");
    const mark = events.length;
    await in_active_tab("(() => { const field = document.getElementById('host').shadowRoot.getElementById('editable'); const range = document.createRange(); range.setStart(field.firstChild, 5); range.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); field.focus(); })()");
    await wait_event(mark, badge_is(page_id, "INSERT"), "the INSERT badge after the field took focus");
    await press_keys("jv");
    const text = await wait_for_field_text("document.getElementById('host').shadowRoot.getElementById('editable')");
    expect(text === "hellojv world", `the field holds ${JSON.stringify(text)}, expected "hellojv world"`);
    await escape_to_normal(page_id);
  });

  // A mouse drag leaves a page selection, which `setBaseAndExtent` stands in for: the code reads only the Selection. The text is "the needle sits here", so 4 to 10 is "needle".
  // The script answers after a frame and a timer, so the page and the caret session have handled the selection change before the next key.
  const drag_in_page = (from, to) => in_active_tab(`(() => { const text = [...document.querySelectorAll('p')].find((p) => p.textContent === 'the needle sits here').firstChild; getSelection().setBaseAndExtent(text, ${from}, text, ${to}); return new Promise((resolve) => requestAnimationFrame(() => setTimeout(() => resolve(true), 0))); })()`);
  // The page reports the drag's selection once, so the caller knows the selection is in place.
  async function drag_and_wait(page_id, from, to, text) {
    const mark = events.length;
    await drag_in_page(from, to);
    await wait_event(mark, (event) => is_selection_of(page_id)(event) && event.text === text, `the drag to select ${text}`);
  }
  // V after a selection: the badge shows V arrived, and the barrier flushes the reports that follow it.
  async function press_visual_and_read(page_id) {
    await press_and_wait_for_badge(page_id, "V", "VISUAL");
    await barrier(page_id);
    return last_selection_text(page_id);
  }
  for (const [name, from, to] of [["forward", 4, 10], ["backward", 10, 4]]) {
    await run_case(`V after a ${name} drag selects the dragged text`, async () => {
      const page_id = `drag_v_${name}`;
      await open_page("caret_bug_find", page_id, { new_tab: true });
      await drag_and_wait(page_id, from, to, "needle");
      const text = await press_visual_and_read(page_id);
      expect(text === "needle", `the selection is ${JSON.stringify(text)}, expected "needle"`);
      // The caret is on the end the mouse was released at, so l moves that end one character: out for a forward drag, in for a backward one.
      const expected = name === "forward" ? "needle " : "eedle";
      const mark = events.length;
      await press_keys("l");
      await wait_for_last_selection(page_id, mark, (last) => last.text === expected, `l to leave the selection as ${JSON.stringify(expected)}`);
      await escape_to_normal(page_id);
    });
    await run_case(`v after a ${name} drag puts the caret where the mouse was released`, async () => {
      const page_id = `drag_c_${name}`;
      await open_page("caret_bug_find", page_id, { new_tab: true });
      await drag_and_wait(page_id, from, to, "needle");
      const expected = name === "forward" ? "e" : "n";
      const mark = events.length;
      await press_keys("v");
      await wait_for_last_selection(page_id, mark, (last) => last.text === expected, `v to put the caret on ${JSON.stringify(expected)}, where the mouse was released`);
      await escape_to_normal(page_id);
    });
  }

  await run_case("a drag made in caret mode is taken whole by v", async () => {
    const page_id = "drag_in_caret";
    await open_page("caret_bug_find", page_id, { new_tab: true });
    await press_and_wait_for_move(page_id, "gV", "the caret on the title");
    await drag_and_wait(page_id, 4, 10, "needle");
    await press_and_wait_for_badge(page_id, "v", "VISUAL");
    await barrier(page_id);
    const text = last_selection_text(page_id);
    expect(text === "needle", `the selection is ${JSON.stringify(text)}, expected "needle"`);
    await escape_to_normal(page_id);
  });

  await run_case("V after a search that came after a drag starts at the match, not the drag", async () => {
    const page_id = "drag_then_search";
    await open_page("caret_bug_find", page_id, { new_tab: true });
    await drag_and_wait(page_id, 4, 10, "needle");
    await search_with_line("filler line 7");
    const mark = events.length;
    await press_keys("V");
    await wait_for_last_selection(page_id, mark, (last) => last.text === "f", 'V to select "f", the first letter of the match');
    await escape_to_normal(page_id);
  });

  await run_case("drawing the painted span again the other way round moves the caret to the release end", async () => {
    const page_id = "drag_reversed";
    await open_page("caret_bug_find", page_id, { new_tab: true });
    await drag_and_wait(page_id, 4, 10, "needle");
    await press_visual_and_read(page_id);
    await drag_in_page(10, 4);
    // The caret is now on the "n", so l takes it one character in.
    const mark = events.length;
    await press_keys("l");
    await wait_for_last_selection(page_id, mark, (last) => last.text === "eedle", 'l to leave the selection as "eedle"');
    await escape_to_normal(page_id);
  });

  await run_case("a drag from the same anchor after a search takes the place of the match", async () => {
    const page_id = "drag_same_anchor";
    await open_page("caret_bug_find", page_id, { new_tab: true });
    await drag_and_wait(page_id, 4, 10, "needle");
    await search_with_line("filler line 7");
    await drag_and_wait(page_id, 4, 15, "needle sits");
    const text = await press_visual_and_read(page_id);
    expect(text === "needle sits", `the selection is ${JSON.stringify(text)}, expected "needle sits"`);
    await escape_to_normal(page_id);
  });
}
