import { evaluate_in_background } from "./rdp.mjs";

// Repro cases for two caret mode bugs: j/k getting stuck, and the caret not starting at a find match.
export const areas = ["caret", "find"];

export async function run_cases({ run_case, expect, open_page, press_keys, poll_until, barrier, wait_cmdline, events, wait_event, rdp, extension_id, in_active_tab, badge_is, is_selection_of, press_and_wait_for_move, escape_to_normal, run_line, expect_absent, hint_label_count }) {
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
    // The caret rests on the first letter of the match. An intermediate report before the find lands is another text.
    await wait_for_last_selection("find_c", mark_search, (last) => last.text === "n", "the caret at the match");
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
    // The first report can be an intermediate selection, so wait for the finished one.
    const reaches_match_start = (last) => last.text.startsWith("caret_bug_find") && last.text.trimEnd().endsWith("n") && !last.text.trimEnd().endsWith("needle");
    await wait_for_last_selection("find_d", mark_search, reaches_match_start, 'the selection to run from the title to the "n" of needle');
    // o swaps the ends, which makes the session adopt the find first. The selected text is the same either way, so o reports nothing and a barrier orders it before the read.
    await press_keys("o");
    await barrier("find_d");
    const text = events.slice(mark_search).filter(is_selection_of("find_d")).at(-1)?.text ?? "";
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
    await press_and_wait_for_move(page_id, "gV", "the caret report from the loaded caret bundle");
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
    await press_and_wait_for_move(page_id, "gV", "the caret report from the loaded caret bundle");
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
  // V after a selection: the badge is drawn before the caret bundle loads, and the load cancels plain keys, so the barrier waits for the bundle's own selection report.
  async function press_visual_and_read(page_id) {
    await press_and_wait_for_move(page_id, "V", "the selection report from the loaded caret bundle");
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

  // The page swaps text under the open session half a second after the first selection report.
  const selection_styles = `[document, ...[...document.querySelectorAll("*")].map((element) => element.shadowRoot), ...[...document.querySelectorAll("iframe")].map((frame) => frame.contentDocument)].filter(Boolean).flatMap((tree) => [...tree.adoptedStyleSheets]).filter((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes("::selection"))).length`;
  await run_case("caret mode survives the page replacing the paragraph that holds the caret", async () => {
    const page_id = "replaced_replace_paragraph";
    await open_page("caret_replaced", page_id, { new_tab: true });
    const mark = events.length;
    await press_keys("gV");
    await wait_event(mark, is_selection_of(page_id), "the caret report");
    await wait_event(mark, (event) => event.type === "text_replaced" && event.page_id === page_id, "the page to replace the heading");
    await press_and_wait_for_move(page_id, "j", "j to move the caret after the replace");
    await press_and_wait_for_move(page_id, "w", "w to move the caret after the replace");
    const on_page = await in_active_tab("(() => { const s = getSelection(); return s.rangeCount > 0 && s.anchorNode.isConnected && String(s) !== ''; })()");
    expect(on_page === true, "the selection is blank or sits on a node the page removed");
    const mark_search = events.length;
    await search_with_line("fresh");
    await wait_for_last_selection(page_id, mark_search, (last) => last.text === "f", 'the caret on the "f" of fresh');
    await escape_to_normal(page_id);
    await poll_until("the selection colors to leave the page", async () => (await in_active_tab(selection_styles)) === 0);
  });

  // Every tree stays alive, so only a mutation tells the session its text is gone.
  await run_case("caret mode survives the page replacing its text", async () => {
    const page_id = "replaced_all";
    await open_page("caret_replaced", page_id, { new_tab: true });
    const mark = events.length;
    await press_keys("gV");
    await wait_event(mark, is_selection_of(page_id), "the caret report");
    await wait_event(mark, (event) => event.type === "text_replaced" && event.page_id === page_id, "the page to replace its text");
    await press_and_wait_for_move(page_id, "j", "j to move the caret after the replace");
    await press_and_wait_for_move(page_id, "w", "w to move the caret after the replace");
    const on_page = await in_active_tab("(() => { const s = getSelection(); return s.rangeCount > 0 && s.anchorNode.isConnected && String(s) !== ''; })()");
    expect(on_page === true, "the selection is blank or sits on a node the page removed");
    const mark_search = events.length;
    await search_with_line("zebra");
    await wait_for_last_selection(page_id, mark_search, (last) => last.text === "z", 'the caret on the "z" of zebra');
    await escape_to_normal(page_id);
    await poll_until("the selection style to leave the page", async () => (await in_active_tab(selection_styles)) === 0);
  });

  // A find needs a character, which the line supplies, and a session to move, which normal mode has not. The command leaves the page alone and nothing waits for the next key.
  await run_case(":caret.find from normal mode starts no session and leaves nothing armed for the next caret key", async () => {
    const page_id = "move_find";
    await open_page("caret", page_id, { new_tab: true });
    const mark = events.length;
    await run_line(":caret.find l");
    await wait_cmdline((line) => !line.open, "the line to close");
    await expect_absent(mark, page_id, (event) => is_selection_of(page_id)(event) || badge_is(page_id, "CARET")(event), "caret mode or a selection after the find command");
    await press_and_wait_for_move(page_id, "gV", "the caret on the title");
    // The title is "caret move_find". l as a motion lands on "a". l as a find target would jump to the "l" of "line".
    const last = await press_and_wait_for_move(page_id, "l", "l to move the caret");
    expect(last.text === "a", `the caret is on ${JSON.stringify(last.text)}, expected "a"`);
    await escape_to_normal(page_id);
  });

  // Pages that add trees after the session started. The sheet probes count the adopted sheets with a ::selection rule on each tree.
  const selection_sheets_of = (tree) => `[...${tree}.adoptedStyleSheets].filter((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes("::selection"))).length`;
  const root_styles = (host_selector) => selection_sheets_of(`document.querySelector(${JSON.stringify(host_selector)}).shadowRoot`);
  const frame_styles = (frame_selector) => selection_sheets_of(`document.querySelector(${JSON.stringify(frame_selector)}).contentDocument`);
  const add_late_root = (text) => in_active_tab(`(() => { const host = document.createElement("div"); host.id = "late_host"; document.body.append(host); host.attachShadow({ mode: "open" }).innerHTML = "<p>${text}</p>"; return true; })()`);

  // A tree that leaves the page makes the next key rebuild the model, and the rebuild brings the new trees. They need the selection style too.
  await run_case("a rebuild after a tree left the page gives the shadow root added meanwhile the selection style", async () => {
    const page_id = "late_root_j";
    await open_page("caret", page_id, { new_tab: true });
    await in_active_tab(`(() => { const host = document.createElement("div"); host.id = "old_host"; document.body.append(host); host.attachShadow({ mode: "open" }).innerHTML = "<p>old words</p>"; return true; })()`);
    await press_and_wait_for_move(page_id, "gV", "the caret on the title");
    await in_active_tab(`document.getElementById("old_host").remove()`);
    await add_late_root("late words");
    await press_and_wait_for_move(page_id, "j", "j to move the caret after the rebuild");
    await poll_until("the selection style in the late root", async () => (await in_active_tab(root_styles("#late_host"))) > 0);
    await escape_to_normal(page_id);
  });

  await run_case("a search match in a shadow root added after caret mode started gets the selection style", async () => {
    const page_id = "late_root_search";
    await open_page("caret", page_id, { new_tab: true });
    await press_and_wait_for_move(page_id, "gV", "the caret on the title");
    await add_late_root("quartz late");
    const mark = events.length;
    await search_with_line("quartz");
    await wait_for_last_selection(page_id, mark, (last) => last.text === "q", 'the caret on the "q" of quartz');
    await poll_until("the selection style in the late root", async () => (await in_active_tab(root_styles("#late_host"))) > 0);
    await escape_to_normal(page_id);
  });

  await run_case("a search match in a frame added after caret mode started gets the selection style", async () => {
    const page_id = "late_frame_search";
    await open_page("caret", page_id, { new_tab: true });
    await press_and_wait_for_move(page_id, "gV", "the caret on the title");
    await in_active_tab(`(() => { const frame = document.createElement("iframe"); frame.id = "late_frame"; frame.srcdoc = "<p>quartz inside</p>"; document.body.append(frame); return new Promise((resolve) => frame.addEventListener("load", () => resolve(true))); })()`);
    await search_with_line("quartz");
    // The added frame has no reporter, so its own selection shows where the caret landed.
    await poll_until('the caret on the "q" of quartz in the frame', async () => (await in_active_tab(`String(document.getElementById("late_frame").contentDocument.getSelection())`)) === "q");
    await poll_until("the selection style in the late frame", async () => (await in_active_tab(frame_styles("#late_frame"))) > 0);
    await escape_to_normal(page_id);
  });

  // A frame that leaves the page while the search line is open must not break Enter. The frame removes itself a second after the caret first lands in it (see /caret_frame_inner).
  // It passes with 70a7719d reverted, so it guards only the visible outcome (caret on the page match, CARET badge), not the thrown paint.
  await run_case("Enter on a search lands on the page after the frame holding the caret left while the line was open", async () => {
    const page_id = "search_remove_frame";
    await open_page("caret_frames", page_id, { new_tab: true });
    const mark = events.length;
    await run_line(":hint --caret --custom --selector=#inner_text");
    await poll_until("the hint labels to show", async () => (await hint_label_count()) > 0);
    await press_keys("a");
    await wait_event(mark, (event) => event.type === "selection" && event.page_id === `${page_id}_inner` && event.text === "i", "the caret in the frame");
    await press_keys("/");
    await wait_cmdline((line) => line.open && line.focused, "the search line to open");
    await press_keys("-d", "30", "tail");
    await wait_cmdline((line) => line.open && line.value === "tail", "the search line to hold tail");
    await poll_until("the frame to leave the page", async () => (await in_active_tab('!document.getElementById("frame")')) === true, { timeout_ms: 5000 });
    const mark_enter = events.length;
    await press_keys("-k", "Return");
    await wait_cmdline((line) => !line.open, "the search line to close");
    await wait_for_last_selection(page_id, mark_enter, (last) => last.text === "t", 'the caret on the "t" of tail on the page');
    await poll_until("the CARET badge after Enter", () => events.filter((event) => event.type === "indicator" && event.page_id === page_id).at(-1)?.label === "CARET");
    await escape_to_normal(page_id);
  });

  // A click leaves a collapsed selection, which gV honors only while it is on screen. This one is inside the frame, 300px below the frame's own viewport. The frame's box puts it inside the top viewport, so a check against the top viewport alone calls it visible.
  await run_case("gV does not start at a click that is outside its frame's viewport", async () => {
    const page_id = "clip_frame";
    await open_page("caret_clip_frame", page_id, { new_tab: true });
    await poll_until("the page to scroll past its title", async () => (await in_active_tab("scrollY")) >= 400);
    await in_active_tab(`(() => { const doc = document.getElementById("clip").contentDocument; doc.getSelection().collapse(doc.getElementById("hidden_text").firstChild, 3); return true; })()`);
    await press_keys("gV");
    await poll_until("the caret on the first text in view", async () => (await in_active_tab(`String(document.getElementById("clip").contentDocument.getSelection())`)) !== "");
    const caret = await in_active_tab(`String(document.getElementById("clip").contentDocument.getSelection())`);
    expect(caret === "s", `the caret is on ${JSON.stringify(caret)}, expected "s" of "shown words", the first text in view`);
    await escape_to_normal(page_id);
  });
}
