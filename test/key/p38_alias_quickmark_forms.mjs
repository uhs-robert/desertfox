// Key test cases of the Aliases and Quickmarks sections and the new tab links row on the settings page: a bad alias shows its problems and stores nothing, a saved alias runs from the command line,
// a saved quickmark opens with `gn`, the links row saves and shows on the new tab page, and the export carries the layers.
// Stored layers survive across cases, so the teardown clears them: the aliases layer in storage with two publishes, the quickmark, and the saved links through the settings message.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["help", "config", "keys", "newtab"];

export async function run_cases({ run_case, open_page, press_keys, poll_until, rdp, extension_id, expect, on_teardown, wait_event, events, run_line }) {
  const view = `(browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.pathname === "/home.html" && candidate.location.hash === "#/settings"))`;
  const in_page = (code) => evaluate_in_background(rdp, extension_id, `(() => { const view = ${view}; ${code} })()`);
  const in_background = (code) => evaluate_in_background(rdp, extension_id, code);
  const close_extension_tabs = () => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes("/home.html") || tab.url.endsWith("/newtab.html")) await browser.tabs.remove(tab.id); })()`);
  const stored = (key) => in_background(`browser.storage.local.get(${JSON.stringify(key)}).then((got) => got[${JSON.stringify(key)}] ?? {})`);
  const tab_count = () => in_background(`browser.tabs.query({}).then((tabs) => tabs.length)`);
  const button_in = (box, label) => `[...view.document.querySelectorAll(".${box} button")].find((button) => button.textContent === ${JSON.stringify(label)})`;

  async function open_settings() {
    await close_extension_tabs();
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/settings"), active: true }).then(() => true)`);
    await poll_until("the new sections to load", () => in_page(`return !!view && view.document.querySelector(".desertfox-aliases input") !== null && view.document.querySelector(".desertfox-quickmarks input") !== null && view.document.querySelector('[data-setting="newtab_links"]') !== null;`).catch(() => false), { timeout_ms: 10000 });
  }

  // The aliases layer is cleared in storage, then the toolbar switch goes off and on: two publishes, so no alias is removed one by one. The switch must end on, or every later piece would run with DesertFox off.
  on_teardown(async () => {
    await open_settings();
    await in_page(`return view.browser.storage.local.remove("desertfox_quickmarks");`);
    await in_page(`return view.browser.runtime.sendMessage({ type: "change_setting", name: "newtab_links", action: "reset" });`);
    if (Object.keys(await stored("desertfox_alias_edits")).length > 0) {
      const answers = await in_page(`return view.browser.storage.local.set({ desertfox_alias_edits: {} }).then(async () => [await view.browser.runtime.sendMessage({ type: "toolbar_set_disabled", disabled: true }), await view.browser.runtime.sendMessage({ type: "toolbar_set_disabled", disabled: false })]);`);
      expect(answers.every((answer) => answer.ok), `the toolbar switch answered ${JSON.stringify(answers)}`);
    }
    await poll_until("DesertFox to be back on", () => in_background(`browser.storage.local.get("desertfox_disabled").then((got) => got.desertfox_disabled !== true)`));
    await close_extension_tabs();
  });

  async function type_field(box, label, text) {
    await in_page(`const input = view.document.querySelector('.${box} [aria-label=${JSON.stringify(label)}]'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new view.Event("input"));`);
  }

  await run_case("aliases form: an unknown command shows the problem and stores nothing, a known one saves and runs from the command line", async () => {
    await open_settings();
    await type_field("desertfox-aliases", "alias name", "p38dup");
    await type_field("desertfox-aliases", "alias command id", "tab.nope");
    await poll_until("Save to turn on", () => in_page(`return !${button_in("desertfox-aliases", "Save alias")}.disabled;`));
    await in_page(`${button_in("desertfox-aliases", "Save alias")}.click();`);
    await poll_until("the form to show the refusal", () => in_page(`const text = view.document.querySelector(".desertfox-aliases").textContent; return text.includes("Edit not saved") && text.includes("unknown command id") && text.includes("Aliases section");`));
    expect(Object.keys(await stored("desertfox_alias_edits")).length === 0, "a refused alias was stored");
    await type_field("desertfox-aliases", "alias command id", "tab.duplicate");
    await poll_until("Save to turn on", () => in_page(`return !${button_in("desertfox-aliases", "Save alias")}.disabled;`));
    await in_page(`${button_in("desertfox-aliases", "Save alias")}.click();`);
    await poll_until("the alias to be stored", async () => (await stored("desertfox_alias_edits")).p38dup === "tab.duplicate");
    await poll_until("the row to list the alias", () => in_page(`return view.document.querySelector(".desertfox-aliases").textContent.includes("p38dup");`));
    await close_extension_tabs();
    await open_page("page", "p38_alias", { new_tab: true });
    const before = await tab_count();
    await run_line(":p38dup");
    await poll_until("the alias to duplicate the tab", async () => (await tab_count()) === before + 1);
  });

  await run_case("quickmarks form: a saved quickmark opens with gn, and Remove drops it", async () => {
    await open_page("page", "p38_page", { new_tab: true });
    const page_url = await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab.url)`);
    const server = new URL(page_url).origin;
    await open_settings();
    await type_field("desertfox-quickmarks", "quickmark key", "ab");
    await type_field("desertfox-quickmarks", "quickmark address", `${server}/page?id=p38_mark`);
    await poll_until("the form to name the key problem", () => in_page(`return view.document.querySelector(".desertfox-quickmarks").textContent.includes("one letter or digit");`));
    expect(await in_page(`return ${button_in("desertfox-quickmarks", "Save quickmark")}.disabled;`), "Save was on with a bad key");
    await type_field("desertfox-quickmarks", "quickmark key", "z");
    await poll_until("Save to turn on", () => in_page(`return !${button_in("desertfox-quickmarks", "Save quickmark")}.disabled;`));
    await in_page(`${button_in("desertfox-quickmarks", "Save quickmark")}.click();`);
    await poll_until("the quickmark to be stored", async () => (await stored("desertfox_quickmarks")).z?.includes("p38_mark"));
    await close_extension_tabs();
    await open_page("page", "p38_use", { new_tab: true });
    const mark = events.length;
    await press_keys("g", "n", "z");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p38_mark", "the quickmark to open in a new tab");
    await open_settings();
    await poll_until("the row to list the quickmark", () => in_page(`return view.document.querySelector('[aria-label="Remove the quickmark z"]') !== null;`));
    await in_page(`view.document.querySelector('[aria-label="Remove the quickmark z"]').click();`);
    await poll_until("Remove to drop the quickmark", async () => (await stored("desertfox_quickmarks")).z === undefined);
    await in_page(`return view.browser.runtime.sendMessage({ type: "change_quickmarks", action: "set", key: "y", url: "https://y.test/" });`);
  });

  await run_case("new tab links row: a link saves as a saved setting and shows on the new tab page, and the export carries every layer", async () => {
    await open_settings();
    await in_page(`${button_in("desertfox-settings", "Add link")}.click();`);
    await type_field("desertfox-settings", "newtab_links label", "P38 mail");
    await type_field("desertfox-settings", "newtab_links address", "https://mail.p38.test/");
    await in_page(`view.document.querySelector('.desertfox-settings [aria-label="newtab_links address"]').dispatchEvent(new view.Event("change"));`);
    await poll_until("the link to be saved", async () => (await stored("desertfox_saved_settings")).newtab_links?.[0]?.label === "P38 mail");
    const exported = await in_page(`return view.browser.runtime.sendMessage({ type: "export_config" }).then((answer) => ({ ok: answer.ok, aliases: answer.config_files?.["command_aliases.d/zz-saved-edits.toml"], quickmarks: answer.config_files?.["quickmarks.d/zz-saved-edits.toml"], saved: answer.config_files?.["settings.d/zz-saved-edits.toml"] }));`);
    expect(exported.ok && /p38dup/.test(exported.aliases ?? "") && /y\s*=/.test(exported.quickmarks ?? "") && /P38 mail/.test(exported.saved ?? ""), `the export held ${JSON.stringify(exported)}`);
    await close_extension_tabs();
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("newtab.html") })`);
    await poll_until("the new tab page to list the link", () => in_background(`!!(browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.pathname === "/newtab.html"))?.document.body.textContent.includes("P38 mail")`).catch(() => false), { timeout_ms: 10000 });
  });
}
