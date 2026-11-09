// A probe of key delivery, not a check of DesertFox: it presses every key the pieces use and reads back the page's
// keydown reports, then measures how soon a key reaches a page that just loaded.
// Runs only with KEY_TEST_PROBE=1, alone: KEY_TEST_PROBE=1 KEY_TEST_PIECES=p97_key_delivery KEY_TEST_DEADLINE_S=900 just key-test
// KEY_TEST_PROBE_ROUNDS sets how often each key is pressed (default 20). The counts print as one `probe:` line per part.
import { SHIFT_ESCAPE } from "./harness.mjs";
import { evaluate_in_chrome } from "./rdp.mjs";

export const areas = ["keys"];

const PUNCTUATION_CODES = {
  " ": "Space", "!": "Digit1", "@": "Digit2", "#": "Digit3", $: "Digit4", "%": "Digit5", "^": "Digit6", "&": "Digit7", "*": "Digit8", "(": "Digit9", ")": "Digit0",
  "-": "Minus", _: "Minus", "=": "Equal", "+": "Equal", "[": "BracketLeft", "{": "BracketLeft", "]": "BracketRight", "}": "BracketRight",
  "\\": "Backslash", "|": "Backslash", ";": "Semicolon", ":": "Semicolon", "'": "Quote", '"': "Quote", "`": "Backquote", "~": "Backquote",
  ",": "Comma", "<": "Comma", ".": "Period", ">": "Period", "/": "Slash", "?": "Slash",
};

// The US code of each printable ASCII character, which a real keyboard sends.
function us_code_of(character) {
  if (/[a-z]/i.test(character)) return `Key${character.toUpperCase()}`;
  if (/\d/.test(character)) return `Digit${character}`;
  return PUNCTUATION_CODES[character];
}

// `-` alone is wtype's "read stdin", so it goes by its keysym name.
const printable_presses = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).map((character) => ({
  args: character === "-" ? ["-k", "minus"] : [character], key: character, code: us_code_of(character),
}));
// Keys a field passes to the page. Escape and Tab leave the field, so they run in ignore mode on a plain page.
const field_named_presses = [
  ["BackSpace", "Backspace", "Backspace"], ["bracketleft", "[", "BracketLeft"], ["bracketright", "]", "BracketRight"],
  ["Down", "ArrowDown", "ArrowDown"], ["Up", "ArrowUp", "ArrowUp"], ["Left", "ArrowLeft", "ArrowLeft"],
  ["Next", "PageDown", "PageDown"], ["Prior", "PageUp", "PageUp"], ["Return", "Enter", "Enter"], ["F8", "F8", "F8"],
].map(([keysym, key, code]) => ({ args: ["-k", keysym], key, code }));
// Tab comes last: on a page with nothing to focus it moves the focus into the browser toolbar, and the case puts it back.
const page_named_presses = [["Escape", "Escape", "Escape"], ["Tab", "Tab", "Tab"]].map(([keysym, key, code]) => ({ args: ["-k", keysym], key, code }));
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);
const KEY_REPORT_TIMEOUT_MS = 600;
const PAGE_AGES_MS = [0, 30, 100, 300];
const AGE_BATCH = 10;

export async function run_cases({ run_case, setup, open_page, press_keys, wait_event, events, in_background, url_of, sleep, record, rdp }) {
  if (process.env.KEY_TEST_PROBE !== "1") return;
  const rounds = Number(process.env.KEY_TEST_PROBE_ROUNDS ?? 20);
  const tally = { presses: 0, lost: 0, wrong_key: 0, wrong_code: 0, real_shift: 0 };
  const wrong_codes = new Map();
  const wrong_keys = new Map();
  const count_into = (map, label) => map.set(label, (map.get(label) ?? 0) + 1);

  // Waits for the first keydown that is not a modifier, so a real Shift before a capital is counted apart. An F4 for another key is a late press of the harness's key probe, and so is an F8 of a barrier.
  const is_reading_of = (page_id, key) => (event) => event.type === "keydown" && event.page_id === page_id && !MODIFIER_KEYS.has(event.key) && (!["F4", "F8"].includes(event.key) || key === event.key);
  async function press_and_read(page_id, { args, key, code }) {
    const mark = events.length;
    tally.presses++;
    await press_keys(...args);
    const seen = await wait_event(mark, is_reading_of(page_id, key), `keydown of ${key}`, KEY_REPORT_TIMEOUT_MS).catch(() => undefined);
    if (events.slice(mark).some((event) => event.type === "keydown" && event.key === "Shift")) tally.real_shift++;
    if (!seen) {
      tally.lost++;
      count_into(wrong_keys, `${JSON.stringify(key)}->lost`);
      return;
    }
    if (seen.key !== key) {
      tally.wrong_key++;
      count_into(wrong_keys, `${JSON.stringify(key)}->${JSON.stringify(seen.key)}`);
    }
    if (seen.code !== code) {
      tally.wrong_code++;
      count_into(wrong_codes, `${code}->${seen.code}`);
    }
  }

  for (let round = 0; round < rounds; round++) {
    const field_id = `probe_field_${round}`;
    await setup(`open the field page ${field_id}`, () => open_page("field", field_id, { new_tab: true }));
    await run_case(`round ${round}: printable characters in a field`, async () => {
      for (const press of printable_presses) await press_and_read(field_id, press);
    });
    await run_case(`round ${round}: named keys in a field`, async () => {
      for (const press of field_named_presses) await press_and_read(field_id, press);
    });
    const page_id = `probe_page_${round}`;
    await setup(`open the plain page ${page_id} in ignore mode`, async () => {
      await open_page("page", page_id, { new_tab: true });
      const mark = events.length;
      await press_keys(...SHIFT_ESCAPE);
      await wait_event(mark, (event) => event.type === "indicator" && event.page_id === page_id && event.label === "IGNORE", "the IGNORE badge");
    });
    await run_case(`round ${round}: Escape and Tab in ignore mode`, async () => {
      for (const press of page_named_presses) await press_and_read(page_id, press);
      await evaluate_in_chrome(rdp, "gBrowser.selectedBrowser.focus()");
    });
  }
  const top = (map) => [...map].sort((left, right) => right[1] - left[1]).slice(0, 8).map(([label, count]) => `${label} x${count}`).join(", ");
  console.log(`probe: keys ${JSON.stringify(tally)}`);
  console.log(`probe: wrong codes ${top(wrong_codes) || "none"}`);
  console.log(`probe: wrong or lost keys ${top(wrong_keys) || "none"}`);
  for (const [name, value] of Object.entries(tally)) record(`probe_${name}`, value);

  // The age counts from the page's tree_read report, the first sign that its content script runs.
  // The open goes straight through the background, past open_page and its 300 ms floor.
  const age_lost = Object.fromEntries(PAGE_AGES_MS.map((age) => [age, { lost: 0, elsewhere: 0, tries: 0 }]));
  let load_number = 0;
  await setup("open a page that holds the focus", () => open_page("page", "probe_age_start", { new_tab: true }));
  for (const age_ms of PAGE_AGES_MS) {
    for (let batch_start = 0; batch_start < rounds; batch_start += AGE_BATCH) {
      await run_case(`F8 at ${age_ms} ms of page age, tries ${batch_start} to ${Math.min(rounds, batch_start + AGE_BATCH) - 1}`, async () => {
        for (let attempt = batch_start; attempt < Math.min(rounds, batch_start + AGE_BATCH); attempt++) {
          const page_id = `probe_age_${load_number++}`;
          const mark = events.length;
          await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => browser.tabs.update(tab.id, { url: ${JSON.stringify(url_of("page", page_id))} })).then(() => true)`);
          await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === page_id, `content script ready on ${page_id}`, 6000);
          if (age_ms > 0) await sleep(age_ms);
          const press_mark = events.length;
          await press_keys("-k", "F8");
          const seen = await wait_event(press_mark, (event) => event.type === "keydown" && event.key === "F8", `F8 on ${page_id}`, 1000).catch(() => undefined);
          age_lost[age_ms].tries++;
          if (!seen) age_lost[age_ms].lost++;
          else if (seen.page_id !== page_id) age_lost[age_ms].elsewhere++;
        }
      });
    }
  }
  console.log(`probe: page age ${JSON.stringify(age_lost)}`);
  for (const age_ms of PAGE_AGES_MS) record(`probe_age_${age_ms}_lost`, age_lost[age_ms].lost);
}
