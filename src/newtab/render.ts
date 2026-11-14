// The built-in page: the clock (analog or digital), the date and the lists of links.
import type { Settings } from "../shared/config.ts";
import { browser_page_readers, read_sections, type ListSection, type PageReaders } from "./lists.ts";
import { refused_as, warn_and_go } from "../shared/swallow.ts";
import { draw_tile } from "./tile.ts";
import { forget_ip_info, start_ip_info } from "./ip_info.ts";
import { forget_weather, start_weather } from "./weather.ts";
import { draw_clock } from "./clock.ts";
import { draw_digital_clock } from "./digital_clock.ts";

type WidgetSettings = Pick<Settings, "newtab_clock" | "newtab_date" | "newtab_clock_format" | "newtab_bookmarks" | "newtab_bookmarks_max" | "newtab_recent_tabs" | "newtab_recent_tabs_max" | "newtab_closed_tabs" | "newtab_closed_tabs_max" | "newtab_top_sites" | "newtab_top_sites_max" | "newtab_command_hint" | "newtab_links" | "newtab_weather" | "newtab_weather_city" | "newtab_weather_units" | "newtab_ip_info">;

// Each widget needs only to be not `false`. The clock is analog unless set to "digital".
export function enabled_widgets(settings: WidgetSettings) {
  return {
    clock: settings.newtab_clock !== false,
    clock_style: settings.newtab_clock === "digital" ? ("digital" as const) : ("analog" as const),
    date: settings.newtab_date !== false,
  };
}

export function date_text(time: Date): string {
  return time.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

// Every row is one card that is one anchor, so hints reach it once. A recent tab row switches to its tab instead of opening a second copy.
export function draw_sections(sections: readonly ListSection[]): HTMLElement {
  const lists = document.createElement("div");
  lists.className = "lists";
  for (const section of sections) {
    const list = document.createElement("section");
    if (section.title) {
      const heading = document.createElement("h4");
      heading.textContent = section.title;
      list.append(heading);
    }
    const items = document.createElement("div");
    items.className = "tiles";
    for (const row of section.rows) {
      const anchor = draw_tile(row);
      const tab = row.tab;
      const session_id = row.session_id;
      if (session_id) {
        anchor.addEventListener("click", (event) => {
          event.preventDefault();
          // The session may be gone (restored or forgotten elsewhere), so open the address instead.
          void browser.sessions.restore(session_id).catch(() => browser.tabs.create({ url: row.url }).catch(warn_and_go("closed tab card: restore and open both failed")));
        });
      }
      if (tab) {
        anchor.addEventListener("click", (event) => {
          event.preventDefault();
          void browser.tabs.update(tab.id, { active: true }).then(() => browser.windows.update(tab.window_id, { focused: true }));
        });
      }
      items.append(anchor);
    }
    list.append(items);
    lists.append(list);
  }
  return lists;
}

// A button, so a hint reaches it. It asks the background to run `cmdline.open` in this tab, the same command the colon key runs. No input, so the address bar keeps the focus on a new tab.
export function draw_command_hint(): HTMLButtonElement {
  const hint = document.createElement("button");
  hint.type = "button";
  hint.className = "command-hint";
  const key = document.createElement("kbd");
  key.textContent = ":";
  const before = document.createElement("span");
  before.textContent = "press ";
  const after = document.createElement("span");
  after.textContent = " for the command line";
  hint.append(before, key, after);
  hint.addEventListener("click", () => {
    void browser.runtime.sendMessage({ type: "run", invocations: [{ id: "cmdline.open" }], mode: "normal" });
  });
  return hint;
}

// Calls `tick` now and every second while the tab is visible. A hidden tab stops ticking. The first tick after it shows again lands past the animation gap, so the hands jump to the time. Returns the stop, which also removes the page listener.
export function run_ticker(tick: () => void): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const start = () => {
    tick();
    timer = setInterval(tick, 1000);
  };
  const on_visibility = () => {
    clearInterval(timer);
    if (!document.hidden) start();
  };
  document.addEventListener("visibilitychange", on_visibility);
  if (!document.hidden) start();
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", on_visibility);
  };
}

// The page now on screen and how to stop its clock. A redraw stops it before the new page takes its place, so two clocks never tick.
let drawn: { page: HTMLElement; stop_ticker: () => void } | undefined;

function build_page(settings: WidgetSettings): { page: HTMLElement; stop_ticker: () => void } {
  const page = document.createElement("main");
  page.className = "desertfox-newtab";
  const enabled = enabled_widgets(settings);
  if (!enabled.clock && !enabled.date) return { page, stop_ticker: () => {} };
  const time_block = document.createElement("div");
  time_block.className = "time";
  const slot = document.createElement("div");
  slot.className = "time-area";
  slot.append(time_block);
  page.append(slot);

  const clock = !enabled.clock ? null : enabled.clock_style === "digital" ? draw_digital_clock(settings.newtab_clock_format) : draw_clock();
  if (clock) time_block.append(clock.element);
  const date = document.createElement("h3");
  date.className = "date";
  if (enabled.date) time_block.append(date);

  // The tick also rewrites the date, so a tab left open past midnight shows the new day.
  const stop_ticker = run_ticker(() => {
    const now = new Date();
    clock?.update(now);
    if (enabled.date) date.textContent = date_text(now);
  });
  return { page, stop_ticker };
}

// The first call puts the page in at once and fills the lists when they arrive. A later call builds the new page off screen and swaps it in with its lists, so the page height holds and the scroll position stays. The returned promise settles after the swap. Calls must not overlap, which `follow_settings` guarantees.
export async function render_new_tab(body: HTMLElement, settings: WidgetSettings, readers: PageReaders = browser_page_readers): Promise<void> {
  const next = build_page(settings);
  const previous = drawn;
  if (!previous) {
    drawn = next;
    body.prepend(next.page);
  }
  let sections: ListSection[];
  try {
    sections = await read_sections(settings, readers);
  } catch (error) {
    // The old page stays on screen, so its clock keeps running and the new one stops.
    if (previous) next.stop_ticker();
    throw error;
  }
  if (sections.length > 0) next.page.append(draw_sections(sections));
  if (settings.newtab_command_hint) next.page.append(draw_command_hint());
  if (settings.newtab_weather !== true) void refused_as(forget_weather(), undefined);
  if (settings.newtab_weather === true) {
    // A corner of the page, outside the centered column. The fetch is not awaited, so a slow or failed request never holds the page.
    const slot = document.createElement("div");
    slot.className = "weather";
    next.page.append(slot);
    const weather = start_weather(slot, settings);
    const stop_ticker = next.stop_ticker;
    // A redraw stops the weather run with the clock, so a pending request never outlives its page.
    next.stop_ticker = () => {
      stop_ticker();
      weather.stop();
    };
  }
  if (settings.newtab_ip_info !== true) void refused_as(forget_ip_info(), undefined);
  if (settings.newtab_ip_info === true) {
    const slot = document.createElement("div");
    slot.className = "ip-info";
    (next.page.querySelector(".time") ?? next.page).append(slot);
    const ip_info = start_ip_info(slot, settings);
    const stop_ticker = next.stop_ticker;
    next.stop_ticker = () => {
      stop_ticker();
      ip_info.stop();
    };
  }
  if (previous) {
    previous.stop_ticker();
    previous.page.replaceWith(next.page);
    drawn = next;
  }
}
