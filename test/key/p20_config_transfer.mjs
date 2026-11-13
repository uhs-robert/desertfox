// Key test case of the settings page transfer section: an import shows the snippet's code and asks first, and stores only what is ticked.
import { write_zip } from "../../src/shared/zip.ts";
import { evaluate_in_background } from "./rdp.mjs";

export const areas = ["help", "config"];

export async function run_cases({ run_case, poll_until, rdp, extension_id, expect, take_shot, sleep }) {
  const view = `(browser.extension.getViews({ type: "tab" }).find((candidate) => candidate.location.pathname === "/home.html" && candidate.location.hash === "#/settings"))`;
  const in_page = (code) => evaluate_in_background(rdp, extension_id, `(() => { const view = ${view}; ${code} })()`);
  const in_background = (code) => evaluate_in_background(rdp, extension_id, code);
  const close_tabs = () => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.includes("/home.html")) await browser.tabs.remove(tab.id); })()`);
  const stored_files = () => in_background(`browser.storage.local.get("desertfox_files_source").then((got) => Object.keys(got.desertfox_files_source?.files ?? {}).sort())`);

  const snippet = (id, word) => `// id: ${id}\n// label: ${word}\n// intent: Say ${word}.\n// matches: https://transfer.test/*\nglobalThis.${word} = 1;\n`;
  const zip = write_zip({ "desertfox/snippets/keep.js": snippet("user.keep", "keepword"), "desertfox/snippets/drop.js": snippet("user.drop", "dropword") });

  await run_case("settings page: an import shows each snippet's code and stores only the ticked one", async () => {
    await close_tabs();
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/settings") }).then(() => true)`);
    await poll_until("the settings page to list the settings", () => in_page(`return !!view && view.document.querySelectorAll("[data-setting]").length > 20 && !!view.document.querySelector('[data-transfer="import-zip"]');`).catch(() => false), { timeout_ms: 10000 });
    const before = await stored_files();

    await in_page(`const input = view.document.querySelector('[data-transfer="import-zip"]'); const transfer = new view.DataTransfer(); transfer.items.add(new view.File([new view.Uint8Array(${JSON.stringify([...zip])})], "config.zip")); input.files = transfer.files; input.dispatchEvent(new view.Event("change"));`);
    await poll_until("the consent screen to list both snippets", () => in_page(`return view.document.querySelectorAll("[data-snippet]").length === 2;`).catch(() => false));
    const shown = await in_page(`const text = view.document.querySelector(".desertfox-transfer-review").textContent; return { code: text.includes("keepword = 1") && text.includes("dropword = 1"), matches: text.includes("https://transfer.test/*"), warning: text.includes("every DesertFox permission") };`);
    expect(shown.code && shown.matches && shown.warning, `the consent screen lacked the code, the matches or the warning: ${JSON.stringify(shown)}`);
    expect(JSON.stringify(await stored_files()) === JSON.stringify(before), `files were stored before consent: ${JSON.stringify(await stored_files())}`);

    await in_page(`view.document.querySelector('[data-snippet="snippets/keep.js"]').click(); [...view.document.querySelectorAll(".desertfox-transfer-review button")].find((button) => button.textContent === "Import").click();`);
    await poll_until("the import to store the ticked snippet", async () => (await stored_files()).includes("snippets/keep.js"));
    const after = await stored_files();
    expect(!after.includes("snippets/drop.js"), `the unticked snippet was stored: ${JSON.stringify(after)}`);
    await poll_until("the installed list to show the snippet", () => in_page(`return [...view.document.querySelectorAll(".desertfox-transfer-installed")].some((row) => row.textContent.includes("snippets/keep.js"));`).catch(() => false));

    await in_page(`view.document.querySelector('[aria-label="Remove snippets/keep.js"]').click();`);
    await poll_until("the removal to drop the snippet", async () => !(await stored_files()).includes("snippets/keep.js"));
    await close_tabs();
  });

  await run_case("settings page: a pending host start shows a banner with the changes and the choices, and follows storage", async () => {
    await close_tabs();
    const pending = { config_dir: "/key-test/desertfox", host_digest: "h", browser_digest: "b", changes: [{ path: "settings.toml", kind: "replaced" }, { path: "keymap.toml", kind: "added" }] };
    await in_background(`browser.storage.local.set({ desertfox_host_start_pending: ${JSON.stringify(pending)} }).then(() => true)`);
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("home.html#/settings") }).then(() => true)`);
    await poll_until("the banner to show", () => in_page(`return !!view && (view.document.querySelector(".desertfox-host-start")?.textContent ?? "").includes("keymap.toml");`).catch(() => false), { timeout_ms: 10000 });
    const shown = await in_page(`const box = view.document.querySelector(".desertfox-host-start"); return { dir: box.textContent.includes("/key-test/desertfox"), buttons: [...box.querySelectorAll("button")].map((button) => button.textContent) };`);
    expect(shown.dir && JSON.stringify(shown.buttons) === JSON.stringify(["Export settings", "Use the files in the folder", "Keep what Firefox has"]), `the banner lacked the folder or the buttons: ${JSON.stringify(shown)}`);
    // Set DESERTFOX_SHOT_DIR to also save a screenshot of the banner.
    if (process.env.DESERTFOX_SHOT_DIR) { await sleep(300); await take_shot(`${process.env.DESERTFOX_SHOT_DIR}/host-start-banner.png`); }
    // The digests are made up, so the background refuses whatever the folder holds, and says why.
    await in_page(`[...view.document.querySelectorAll(".desertfox-host-start button")].find((button) => button.textContent === "Keep what Firefox has").click();`);
    await poll_until("the answer to show", () => in_page(`return (view.document.querySelector(".desertfox-host-start [role=status]")?.textContent ?? "") !== "";`).catch(() => false));
    await in_background(`browser.storage.local.remove("desertfox_host_start_pending").then(() => true)`);
    await poll_until("the banner to drop the question", () => in_page(`return !(view.document.querySelector(".desertfox-host-start")?.textContent ?? "").includes("keymap.toml");`).catch(() => false));
    await close_tabs();
  });
}
