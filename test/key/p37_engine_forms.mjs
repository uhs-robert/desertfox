// Key test cases of the Search engines section on the settings page: the add form saves an engine with a key letter, the letter searches in an open tab at once,
// the starter set adds the sample engines, and the export carries the layer. Stored layers survive across cases, so the teardown clears the layer in storage and publishes twice.
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["help", "config", "engines"];

export async function run_cases({ run_case, open_page, press_keys, poll_until, rdp, extension_id, expect, on_teardown, wait_event, events }) {
  const view = `(browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.pathname === "/home.html" && candidate.location.hash === "#/settings"))`;
  const in_page = (code) => evaluate_in_background(rdp, extension_id, `(() => { const view = ${view}; ${code} })()`);
  const in_background = (code) => evaluate_in_background(rdp, extension_id, code);
  const close_settings_tabs = () => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes("/home.html")) await browser.tabs.remove(tab.id); })()`);
  const layer = () => in_background(`browser.storage.local.get("desertfox_engine_edits").then((got) => got.desertfox_engine_edits ?? {})`);
  const button_named = (label) => `[...view.document.querySelectorAll(".desertfox-engines button")].find((button) => button.textContent === ${JSON.stringify(label)})`;

  async function open_settings() {
    await close_settings_tabs();
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/settings"), active: true }).then(() => true)`);
    await poll_until("the engines section to load", () => in_page(`return !!view && view.document.querySelector(".desertfox-engines input") !== null && !view.document.querySelector(".desertfox-engines").textContent.includes("Loading");`).catch(() => false), { timeout_ms: 10000 });
  }

  // The layer is cleared in storage, then the toolbar switch goes off and on: two publishes, so no engine is removed one by one and no letter stays behind. The switch must end on, or every later piece would run with DesertFox off.
  on_teardown(async () => {
    const stored = await layer();
    if (Object.keys(stored.engines ?? {}).length + Object.keys(stored.letters ?? {}).length > 0) {
      await open_settings();
      const answers = await in_page(`return view.browser.storage.local.set({ desertfox_engine_edits: {} }).then(async () => [await view.browser.runtime.sendMessage({ type: "toolbar_set_disabled", disabled: true }), await view.browser.runtime.sendMessage({ type: "toolbar_set_disabled", disabled: false })]);`);
      expect(answers.every((answer) => answer.ok), `the toolbar switch answered ${JSON.stringify(answers)}`);
      await poll_until("the engines layer to be gone and DesertFox back on", () => in_background(`browser.storage.local.get(["desertfox_layered_config", "desertfox_disabled"]).then((got) => got.desertfox_layered_config == null && got.desertfox_disabled !== true)`));
    }
    await close_settings_tabs();
  });

  async function type_field(label, text) {
    await in_page(`const input = view.document.querySelector('.desertfox-engines [aria-label=${JSON.stringify(label)}]'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new view.Event("input"));`);
  }

  await run_case("engine form: a bad address shows the problem and keeps Save off, a good one saves the engine and its key letter", async () => {
    await open_settings();
    await type_field("Name", "p37wiki");
    await type_field("Address", "ftp://x.test/{query}");
    await poll_until("the form to name the address problem", () => in_page(`return view.document.querySelector(".desertfox-engines").textContent.includes("starts with http");`));
    expect(await in_page(`return ${button_named("Save engine")}.disabled;`), "Save was on with a bad address");
    await open_page("page", "p37_page", { new_tab: true });
    const page_url = await in_background(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab.url)`);
    const server = new URL(page_url).origin;
    await open_settings();
    await type_field("Name", "p37wiki");
    await type_field("Address", `${server}/page?id=p37_engine&q={query}`);
    await type_field("Key letter (optional)", "W");
    await poll_until("Save to turn on", () => in_page(`return !${button_named("Save engine")}.disabled;`));
    await in_page(`${button_named("Save engine")}.click();`);
    await poll_until("the engine to be stored", async () => (await layer()).engines?.p37wiki !== undefined && (await layer()).letters?.W === "p37wiki");
    await poll_until("the row to list the engine", () => in_page(`return view.document.querySelector(".desertfox-engines").textContent.includes("p37wiki");`));
  });

  await run_case("engine form: the saved key letter searches the selection in an open tab at once", async () => {
    await close_settings_tabs();
    await open_page("page", "p37_use", { new_tab: true });
    await in_background(`(async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      await browser.tabs.executeScript(tab.id, { code: "getSelection().selectAllChildren(document.body)" });
    })()`);
    const mark = events.length;
    await press_keys("sW");
    await wait_event(mark, (event) => event.type === "tree_read" && event.page_id === "p37_engine", "the page of the added engine");
  });

  await run_case("engine form: a refused engine shows every problem in the form and stores nothing, and Remove drops the engine", async () => {
    await open_settings();
    await in_page(`return view.browser.runtime.sendMessage({ type: "change_engines", action: "set", name: "p37dup", url: "https://d.test/?q={query}", keyword: "g" });`);
    await poll_until("the dup engine to be listed", () => in_page(`return view.document.querySelector('[aria-label="Remove the engine p37dup"]') !== null;`));
    await type_field("Name", "p37clash");
    await type_field("Address", "https://c.test/?q={query}");
    await type_field("Keyword (optional)", "g");
    await poll_until("Save to turn on", () => in_page(`return !${button_named("Save engine")}.disabled;`));
    await in_page(`${button_named("Save engine")}.click();`);
    await poll_until("the form to show the refusal", () => in_page(`const text = view.document.querySelector(".desertfox-engines").textContent; return text.includes("Edit not saved") && text.includes("keyword") && text.includes("Search engines section");`));
    expect((await layer()).engines?.p37clash === undefined, "a refused engine was stored");
    await in_page(`${`view.document.querySelector('[aria-label="Remove the engine p37dup"]')`}.click();`);
    await poll_until("Remove to drop the engine", async () => (await layer()).engines?.p37dup === undefined);
  });

  await run_case("engine form: the starter set adds the sample engines and the export carries the layer as .d files", async () => {
    await open_settings();
    await in_page(`${button_named("Add the starter engines")}.click();`);
    await poll_until("the starter engines to be stored", async () => (await layer()).engines?.stackoverflow !== undefined);
    const exported = await in_page(`return view.browser.runtime.sendMessage({ type: "export_config" }).then((answer) => ({ ok: answer.ok, engines: answer.config_files?.["search_engines.d/zz-saved-edits.toml"], keys: answer.config_files?.["keymap.d/zz-saved-edits.toml"] }));`);
    expect(exported.ok && /stackoverflow/.test(exported.engines ?? "") && /W\s*=\s*"p37wiki"/.test(exported.keys ?? ""), `the export held ${JSON.stringify(exported)}`);
    await close_settings_tabs();
  });
}
