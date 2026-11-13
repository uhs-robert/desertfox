// The new tab page widgets: the analog clock and the date.
// It swaps the config and reloads. The reload once hung when this file ran last; that did not reproduce in one filtered run with this file last. Shots go to DESERTFOX_SHOT_DIR when it is set.
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate_in_background } from "./rdp.mjs";

const test_config_dir = join(dirname(fileURLToPath(import.meta.url)), "config");
const NEWTAB_VIEW = `(browser.extension.getViews({ type: "tab" }).find((view) => view.location.pathname === "/newtab.html"))`;

export const areas = ["newtab", "config"];

export async function run_cases({ config_dir, load_config_dir, take_shot, run_case, expect, poll_until, press_keys, open_page, rdp, extension_id }) {
  const shot_dir = process.env.DESERTFOX_SHOT_DIR;
  const in_background = (script) => evaluate_in_background(rdp, extension_id, script);

  const open_new_tab = async (selector) => {
    await in_background(`browser.tabs.create({ url: browser.runtime.getURL("newtab.html") })`);
    return poll_until(`the new tab page to render ${selector}`, () => in_background(`!!${NEWTAB_VIEW}?.document.querySelector(${JSON.stringify(selector)})`).catch(() => false), { timeout_ms: 10000 }).then(() => true, () => false);
  };
  const close_new_tabs = () => in_background(`(async () => { for (const tab of await browser.tabs.query({})) if (tab.url.endsWith("/newtab.html")) await browser.tabs.remove(tab.id); })()`);
  const parts_of_page = () => in_background(`(() => { const page = ${NEWTAB_VIEW}.document; return { clock: !!page.querySelector("svg.clock"), ticks: page.querySelectorAll("svg.clock line").length, second_hand: page.querySelector("svg.clock .second")?.style.transform ?? "", date: page.querySelector(".date")?.textContent ?? "" }; })()`);

  try {
    await run_case("the new tab page shows the 12 hour clock without ticks, and the date", async () => {
      expect(await open_new_tab("svg.clock"), "the clock never rendered");
      // The hands and the date fill in after the clock element exists.
      await poll_until("the hands and the date to render", async () => { const shown = await parts_of_page(); return shown.ticks === 3 && shown.second_hand !== "" && shown.date !== ""; });
      const parts = await parts_of_page();
      expect(parts.ticks === 3, `expected only the three hands as lines, found ${parts.ticks}`);
      expect(parts.second_hand.startsWith("rotate("), `the seconds hand had no angle: ${parts.second_hand}`);
      expect(parts.date !== "" && !/\d{4}/.test(parts.date), `the date line was ${parts.date}`);
      if (shot_dir) await take_shot(`${shot_dir}/newtab-clock.png`);
    });

    const hidden_config = mkdtempSync(join(tmpdir(), "desertfox-widgets-"));
    cpSync(test_config_dir, hidden_config, { recursive: true });
    writeFileSync(join(hidden_config, "settings.toml"), "newtab_clock = false\n");
    await close_new_tabs();
    // load_config_dir types ,r, so a normal page must hold the keys.
    await open_page("page", "widgets_config", { new_tab: true });
    await load_config_dir(hidden_config);

    await run_case("newtab_clock = false hides the clock and keeps the date", async () => {
      expect(await open_new_tab(".date"), "the date never rendered");
      const parts = await parts_of_page();
      expect(!parts.clock, "the clock showed with newtab_clock = false");
    });
    // Cards: links, recent tabs and bookmarks. The cache is seeded for one site, so the shot shows an icon tile beside letter tiles.
    const cards_config = mkdtempSync(join(tmpdir(), "desertfox-cards-"));
    cpSync(test_config_dir, cards_config, { recursive: true });
    const links = ["Docs", "Mail", "News"].map((name) => `[[newtab_links]]\nlabel = "${name}"\nurl = "https://${name.toLowerCase()}.example.org/"\ngroup = "Pinned"\n`).join("\n");
    writeFileSync(join(cards_config, "settings.toml"), `newtab_recent_tabs = true\nnewtab_bookmarks = true\nnewtab_bookmarks_max = 4\n\n${links}`);
    await close_new_tabs();
    await open_page("page", "cards_a", { new_tab: true });
    await open_page("page", "cards_b", { new_tab: true });
    await load_config_dir(cards_config);
    const dot = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3' fill='%23c0392b'/></svg>";
    await in_background(`(async () => { for (const [title, host] of [["Firefox source docs", "firefox-source-docs.mozilla.org"], ["A long bookmark title that cannot fit on one line of a card", "example.net"], ["Arch wiki", "wiki.archlinux.org"], ["Hacker News", "news.ycombinator.com"], ["Rust reference", "doc.rust-lang.org"]]) await browser.bookmarks.create({ title, url: "https://" + host + "/" }); await browser.storage.local.set({ favicon_cache: [{ host: "doc.rust-lang.org", icon: ${JSON.stringify(dot)}, source: "seed" }] }); })()`);

    await run_case("recent tabs, bookmarks and links are cards with one anchor each, and f labels one per card", async () => {
      expect(await open_new_tab(".tiles .tile"), "no card rendered");
      await poll_until("the cards to render", async () => (await in_background(`${NEWTAB_VIEW}.document.querySelectorAll(".tiles .tile").length`)) >= 8);
      const shape = await in_background(`(() => { const page = ${NEWTAB_VIEW}.document; const cards = [...page.querySelectorAll(".tiles .tile")]; return { cards: cards.length, nested_anchors: cards.filter((card) => card.querySelector("a")).length, letters: page.querySelectorAll(".tile-letter").length, images: page.querySelectorAll("img.tile-icon").length, sites: cards.every((card) => card.querySelector(".tile-site")?.textContent) }; })()`);
      expect(shape.nested_anchors === 0 && shape.sites, `a card holds a nested anchor or has no site: ${JSON.stringify(shape)}`);
      expect(shape.images >= 1 && shape.letters >= 1, `expected an icon and letter tiles: ${JSON.stringify(shape)}`);
      if (shot_dir) await take_shot(`${shot_dir}/newtab-cards.png`);
      // The content script starts after the cards render, so wait for it to read the tree before the key.
      await poll_until("the key handler to start on the new tab page", async () => await in_background(`${NEWTAB_VIEW}.document.documentElement.hasAttribute("data-desertfox-tree-read-ms")`).catch(() => false));
      await press_keys("f");
      const labels = () => in_background(`(() => { const doc = ${NEWTAB_VIEW}.document; return [...doc.documentElement.children].reduce((sum, child) => sum + (child.openOrClosedShadowRoot?.querySelectorAll(".desertfox-hint").length ?? 0), 0); })()`);
      await poll_until("the hint labels to show", async () => (await labels()) > 0);
      // One label per card, plus the three built-in links.
      expect((await labels()) === shape.cards + 3, `expected ${shape.cards + 3} labels, found ${await labels()}`);
      await press_keys("-k", "Escape");
    });

    // The real save path: a page with a favicon is visited, the background redraws the icon Firefox hands it, and the new tab page shows the 32x32 copy. A clear of all history first empties the cache and the saver's memory, so an earlier visit to this host in the session cannot hide the save.
    await run_case("a visited page's favicon is saved as a 32x32 PNG and its card shows it", async () => {
      await close_new_tabs();
      await in_background(`browser.history.deleteAll()`);
      await poll_until("the cache to be empty", async () => (await in_background(`browser.storage.local.get("favicon_cache").then((found) => !found.favicon_cache || found.favicon_cache.length === 0)`)) === true);
      await open_page("iconed", "cards_icon", { new_tab: true });
      const entry_script = `browser.storage.local.get("favicon_cache").then(async (found) => { const entry = (found.favicon_cache ?? []).find((item) => item.host === "127.0.0.1"); if (!entry) return null; const image = new Image(); image.src = entry.icon; await image.decode(); return { icon: entry.icon, width: image.naturalWidth, height: image.naturalHeight }; })`;
      await poll_until("the background to save the icon", async () => (await in_background(entry_script).catch(() => null)) !== null, { timeout_ms: 15000 });
      const saved = await in_background(entry_script);
      expect(saved.icon.startsWith("data:image/png;base64,") && saved.width === 32 && saved.height === 32, `the saved icon was not a 32x32 PNG: ${saved.icon.slice(0, 40)} ${saved.width}x${saved.height}`);
      expect(await open_new_tab(".tiles .tile"), "no card rendered");
      const shown = await in_background(`[...${NEWTAB_VIEW}.document.querySelectorAll(".tiles .tile img.tile-icon")].map((image) => image.getAttribute("src"))`);
      expect(shown.includes(saved.icon), "no card showed the saved icon");
      expect(shown.every((src) => src.startsWith("data:image/")), `an img src was not a data: image: ${JSON.stringify(shown)}`);
    });
  } finally {
    await close_new_tabs().catch(() => undefined);
    await in_background(`(async () => { await browser.storage.local.remove("favicon_cache"); for (const host of ["firefox-source-docs.mozilla.org", "example.net", "wiki.archlinux.org", "news.ycombinator.com", "doc.rust-lang.org"]) for (const mark of await browser.bookmarks.search({ url: "https://" + host + "/" })) await browser.bookmarks.remove(mark.id); })()`).catch(() => undefined);
    await open_page("page", "widgets_restore", { new_tab: true });
    await load_config_dir(config_dir);
  }
}
