// Key test cases of the import-a-theme section under the theme picker: a pasted scheme shows its preview, a bad one shows its problem and stores nothing, a saved one is stored,
// takes `:set theme` and is removed with Remove, which also puts the theme setting back. Set DESERTFOX_SHOT_DIR to also save stills of the importer and its preview.
// Stored imports survive across cases, so the teardown removes each one through the page's own message.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["help", "config"];

const SCHEME = [
  'scheme: "P39 Dusk"',
  'author: "key test"',
  'base00: "1b1d2b"', 'base01: "232638"', 'base02: "2f3350"', 'base03: "5b6188"',
  'base04: "9aa1c9"', 'base05: "c8cdf0"', 'base06: "dfe2f7"', 'base07: "f2f4ff"',
  'base08: "ff6b81"', 'base09: "ffa45c"', 'base0A: "ffd866"', 'base0B: "7bd88f"',
  'base0C: "5ad4e6"', 'base0D: "7aa2f7"', 'base0E: "bb9af7"', 'base0F: "c0765a"',
  "",
].join("\n");

export async function run_cases({ run_case, open_page, poll_until, rdp, extension_id, expect, on_teardown, run_line, take_shot, sleep }) {
  const view = `(browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.pathname === "/home.html" && candidate.location.hash === "#/settings"))`;
  const in_page = (code) => evaluate_in_background(rdp, extension_id, `(() => { const view = ${view}; ${code} })()`);
  const in_background = (code) => evaluate_in_background(rdp, extension_id, code);
  const close_extension_tabs = () => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes("/home.html") || tab.url.endsWith("/newtab.html")) await browser.tabs.remove(tab.id); return true; })()`);
  const stored = (key) => in_background(`browser.storage.local.get(${JSON.stringify(key)}).then((got) => got[${JSON.stringify(key)}] ?? {})`);
  const box_button = (label) => `[...view.document.querySelectorAll(".desertfox-themes button")].find((button) => button.textContent === ${JSON.stringify(label)})`;
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;

  async function open_settings() {
    await close_extension_tabs();
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/settings"), active: true }).then(() => true)`);
    await poll_until("the importer to load", () => in_page(`return !!view && view.document.querySelector(".desertfox-themes textarea") !== null;`).catch(() => false), { timeout_ms: 10000 });
  }
  async function paste(text) {
    await in_page(`const box = view.document.querySelector(".desertfox-themes textarea"); box.value = ${JSON.stringify(text)}; box.dispatchEvent(new view.Event("input"));`);
  }
  async function shot(name) {
    if (!shot_dir) return;
    await in_page(`view.document.querySelector(".desertfox-themes").scrollIntoView({ block: "start" });`);
    await sleep(500);
    await take_shot(`${shot_dir}/${name}.png`);
  }

  on_teardown(async () => {
    await open_settings();
    const names = Object.keys(await stored("desertfox_imported_themes"));
    for (const name of names) await in_page(`return view.browser.runtime.sendMessage({ type: "change_imported_themes", action: "remove", name: ${JSON.stringify(name)} });`);
    await in_page(`return view.browser.runtime.sendMessage({ type: "change_setting", name: "theme", action: "reset" });`);
    await close_extension_tabs();
  });

  await run_case("importer: a pasted scheme shows its preview, a built-in name keeps Save off, Save stores it whole", async () => {
    await open_settings();
    await shot("theme-import-empty");
    await paste(SCHEME);
    await poll_until("the preview to show", () => in_page(`return view.document.querySelector(".desertfox-themes .desertfox-theme-preview") !== null;`));
    const shown = await in_page(`const box = view.document.querySelector(".desertfox-themes"); return { name: box.querySelector('[aria-label="theme name"]').value, hints: box.querySelectorAll(".desertfox-preview-hint").length, badges: box.querySelectorAll(".desertfox-preview-badge").length, toasts: box.querySelectorAll(".desertfox-preview-toast").length, keys: box.querySelectorAll(".desertfox-preview-whichkey-key").length, bg: box.querySelector(".desertfox-theme-preview").style.getPropertyValue("--desertfox-bg-core") };`);
    expect(shown.name === "p39_dusk" && shown.hints === 3 && shown.badges === 5 && shown.toasts === 4 && shown.keys === 4 && shown.bg === "#1b1d2b", `the preview showed ${JSON.stringify(shown)}`);
    expect(Object.keys(await stored("desertfox_imported_themes")).length === 0, "typing stored a theme before Save");
    await shot("theme-import-preview");
    await in_page(`const input = view.document.querySelector('.desertfox-themes [aria-label="theme name"]'); input.value = "oasis_cactus"; input.dispatchEvent(new view.Event("input"));`);
    await poll_until("the built-in name to be refused", () => in_page(`return view.document.querySelector(".desertfox-themes").textContent.includes("built-in theme") && ${box_button("Save theme")}.disabled;`));
    await shot("theme-import-builtin-name");
    await in_page(`const input = view.document.querySelector('.desertfox-themes [aria-label="theme name"]'); input.value = "p39_dusk"; input.dispatchEvent(new view.Event("input"));`);
    await poll_until("Save to turn on", () => in_page(`return !${box_button("Save theme")}.disabled;`));
    await in_page(`${box_button("Save theme")}.click();`);
    await poll_until("the theme to be stored", async () => (await stored("desertfox_imported_themes")).p39_dusk?.dark?.bg_core === "#1b1d2b");
    const kept = (await stored("desertfox_imported_themes")).p39_dusk;
    expect(JSON.stringify(kept.dark) === JSON.stringify(kept.light), "a one-variant scheme did not fill both tables");
    await poll_until("the list to show the theme", () => in_page(`return view.document.querySelector('[aria-label="Remove the theme p39_dusk"]') !== null;`));
    await shot("theme-import-saved");
  });

  await run_case("importer: a partial or malformed paste shows its problem and stores nothing more", async () => {
    await open_settings();
    await paste(SCHEME.replace(/base0[ef].*\n/gi, ""));
    await poll_until("the problem to show", () => in_page(`const box = view.document.querySelector(".desertfox-themes"); return box.textContent.includes("lacks base0E, base0F") && box.querySelector(".desertfox-theme-preview") === null && ${box_button("Save theme")}.disabled;`));
    await shot("theme-import-problem");
    await paste(SCHEME.replace('"7aa2f7"', '"not a color"'));
    await poll_until("the color problem to show", () => in_page(`return view.document.querySelector(".desertfox-themes").textContent.includes("not a six-digit hex color");`));
    expect(Object.keys(await stored("desertfox_imported_themes")).join() === "p39_dusk", "a refused paste changed the stored list");
  });

  await run_case("importer: saving over a name asks first, and the saved theme runs from :set theme", async () => {
    await open_settings();
    await paste(SCHEME.replace('"1b1d2b"', '"0a0b12"'));
    await poll_until("Save to turn on", () => in_page(`return !${box_button("Save theme")}.disabled;`));
    await in_page(`${box_button("Save theme")}.click();`);
    await poll_until("the question to show", () => in_page(`return view.document.querySelector(".desertfox-themes").textContent.includes("is already imported. Replace it?");`));
    expect((await stored("desertfox_imported_themes")).p39_dusk.dark.bg_core === "#1b1d2b", "the theme was replaced before the user answered");
    await shot("theme-import-replace");
    await in_page(`${box_button("Replace")}.click();`);
    await poll_until("the theme to be replaced", async () => (await stored("desertfox_imported_themes")).p39_dusk.dark.bg_core === "#0a0b12");
    await open_page("page", "p39_use", { new_tab: true });
    await run_line(":set theme p39_dusk");
    await poll_until("the stored theme to be the import", async () => (await stored("desertfox_theme")).dark?.bg_core === "#0a0b12");
  });

  await run_case("importer: Remove on the theme in use puts the theme setting back and the default theme on", async () => {
    await open_settings();
    await in_page(`view.document.querySelector('[aria-label="Remove the theme p39_dusk"]').click();`);
    await poll_until("the theme to be gone", async () => Object.keys(await stored("desertfox_imported_themes")).length === 0);
    await poll_until("the default theme to be back", async () => (await stored("desertfox_theme")).dark?.bg_core !== "#0a0b12");
    const setting = await in_page(`return view.browser.runtime.sendMessage({ type: "list_settings" }).then((answer) => answer.settings.find((row) => row.name === "theme"));`);
    expect(setting.top_layer === "default" && setting.value === "oasis_moonlight", `the theme setting was ${JSON.stringify(setting)}`);
    await shot("theme-import-removed");
  });
}
