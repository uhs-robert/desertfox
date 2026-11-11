// blur_on_load: a site row takes the focus away from a field the page focuses as it loads, until the first trusted key or pointer press, or about 1 s after the first install.
// The row lives in a config copy, so no other piece sees it. Cases that need the window still open skip the key probe of `open_page`, because its key press ends the window.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate_in_page_frames } from "./rdp.mjs";

export const areas = ["keys", "config"];

const BLUR_WINDOW_MS = 1000;

export async function run_cases({ run_line, wait_cmdline, config_copy, load_config_dir, setup, run_case, open_page, in_background, in_active_tab, wait_event, wait_takes_keys, settle_focus, poll_until, events, url_of, expect, sleep, rdp }) {
  const badge_of = (page_id) => events.filter((event) => event.type === "indicator" && event.page_id === page_id).at(-1)?.label;
  const focused_id = () => in_active_tab(`document.activeElement?.id ?? ""`);
  const page_state = async (page_id) => `badge ${badge_of(page_id)}, focus on "${await focused_id()}", page has focus ${await in_active_tab("document.hasFocus()")}, events ${JSON.stringify(events.filter((event) => event.page_id === page_id).map((event) => [event.type, event.label ?? event.key ?? event.id ?? ""]))}`;
  const focus_field = (id) => in_active_tab(`document.getElementById(${JSON.stringify(id)}).focus(); document.activeElement?.id ?? ""`);

  await setup("load a config with a blur_on_load row for the blur_ pages", async () => {
    const dir = config_copy();
    appendFileSync(join(dir, "settings.toml"), '\n[[site_rules]]\nsite = "*://127.0.0.1/*?id=blur_*"\nblur_on_load = true\n');
    // The popup's site edits in p19 leave a saved site_rules list, which would hide the file's rows.
    await run_line(":unset site_rules");
    await wait_cmdline((line) => !line.open, "the command line to close");
    await load_config_dir(dir);
  });

  // Opens a tab and waits only for the content script's first install, so no key press ends the window. Returns when the install was reported.
  const open_without_keys = async (kind, id) => {
    const mark = events.length;
    await in_background(`browser.tabs.create({ url: ${JSON.stringify(url_of(kind, id))}, active: true }).then((tab) => tab.id)`);
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === id, `content script ready on ${id}`, 6000);
    return Date.now();
  };
  const expect_in_window = (installed_at, what) => {
    const elapsed = Date.now() - installed_at;
    expect(elapsed < BLUR_WINDOW_MS - 100, `${what} came ${elapsed} ms after the install, too late to test the window`);
  };

  await run_case("a field the page focuses on load loses the focus before insert mode, and a page with no row keeps it", async () => {
    await open_page("field", "blur_field", { new_tab: true });
    await poll_until("NORMAL on the blurred page", async () => badge_of("blur_field") === "NORMAL").catch(async (error) => { throw new Error(`${error.message}: ${await page_state("blur_field")}`); });
    expect((await focused_id()) !== "field", "the field the page focused on load still holds the focus");
    expect(!events.some((event) => event.type === "indicator" && event.page_id === "blur_field" && event.label === "INSERT"), "the page showed INSERT before the blur");
    await open_page("field", "plain_field", { new_tab: true });
    await poll_until("INSERT on the page with no row", async () => badge_of("plain_field") === "INSERT");
  });

  await run_case("a page focus inside the window is blurred, and one after it enters insert mode", async () => {
    const installed_at = await open_without_keys("controls", "blur_late");
    const held = await focus_field("first");
    expect_in_window(installed_at, "the page focus");
    expect(held !== "first", `a page focus inside the window kept the field: ${await page_state("blur_late")}`);
    await sleep(Math.max(0, installed_at + BLUR_WINDOW_MS + 200 - Date.now()));
    expect((await focus_field("first")) === "first", "a page focus after the window lost the field");
    await poll_until("INSERT after the window", async () => badge_of("blur_late") === "INSERT");
    await settle_focus();
  });

  await run_case("a key press inside the window ends it, so a later page focus keeps the field", async () => {
    const installed_at = await open_without_keys("controls", "blur_key");
    await wait_takes_keys("blur_key");
    const held = await focus_field("first");
    expect_in_window(installed_at, "the page focus after the key");
    expect(held === "first", "the page focus after a key press lost the field");
    await poll_until("INSERT after the key", async () => badge_of("blur_key") === "INSERT");
  });

  await run_case("a click on a field inside the window keeps the focus there", async () => {
    const installed_at = await open_without_keys("controls", "blur_click");
    // The press comes from chrome code, so the page sees a trusted pointerdown, as from a real mouse. The focus that a mouse press gives a field follows it.
    const [clicked] = await evaluate_in_page_frames(rdp, "controls", `(win) => {
      const field = win.document.getElementById("first");
      const press = new win.PointerEvent("pointerdown", { bubbles: true, composed: true, pointerType: "mouse" });
      field.dispatchEvent(press);
      field.focus();
      return press.isTrusted ? win.document.activeElement?.id ?? "" : "untrusted press";
    }`);
    expect_in_window(installed_at, "the click");
    expect(clicked === "first", `the click left the focus on "${clicked}"`);
    await poll_until("INSERT after the click", async () => badge_of("blur_click") === "INSERT");
    expect((await focused_id()) === "first", "the field lost the focus after the click");
  });
}
