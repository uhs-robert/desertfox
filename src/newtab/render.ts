// The built-in page: the clock (analog or digital), the date and the lists of links.
import type { Settings } from "../shared/config.ts";
import { browser_page_readers, read_sections, type ListSection, type PageReaders } from "./lists.ts";
import { draw_clock } from "./clock.ts";
import { draw_digital_clock } from "./digital_clock.ts";

type WidgetSettings = Pick<Settings, "newtab_clock" | "newtab_date" | "newtab_clock_format" | "newtab_bookmarks" | "newtab_bookmarks_max" | "newtab_recent_tabs" | "newtab_recent_tabs_max" | "newtab_links">;

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

// Every row is a plain anchor, so hints reach it. A recent tab row switches to its tab instead of opening a second copy.
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
    const items = document.createElement("ul");
    for (const row of section.rows) {
      const anchor = document.createElement("a");
      anchor.href = row.url;
      anchor.textContent = row.label;
      anchor.title = row.url;
      const tab = row.tab;
      if (tab) {
        anchor.addEventListener("click", (event) => {
          event.preventDefault();
          void browser.tabs.update(tab.id, { active: true }).then(() => browser.windows.update(tab.window_id, { focused: true }));
        });
      }
      const item = document.createElement("li");
      item.append(anchor);
      items.append(item);
    }
    list.append(items);
    lists.append(list);
  }
  return lists;
}

export function render_new_tab(body: HTMLElement, settings: WidgetSettings = {}, readers: PageReaders = browser_page_readers): void {
  const page = document.createElement("main");
  page.className = "desertfox-newtab";
  body.prepend(page);

  void read_sections(settings, readers).then((sections) => {
    if (sections.length > 0) page.append(draw_sections(sections));
  });

  const enabled = enabled_widgets(settings);
  if (!enabled.clock && !enabled.date) return;
  const time_block = document.createElement("div");
  time_block.className = "time";
  const slot = document.createElement("div");
  slot.className = "slot-middle-center";
  slot.append(time_block);
  page.append(slot);

  const clock = !enabled.clock ? null : enabled.clock_style === "digital" ? draw_digital_clock(settings.newtab_clock_format ?? 12) : draw_clock();
  if (clock) time_block.append(clock.element);
  const date = document.createElement("h3");
  date.className = "date";
  if (enabled.date) time_block.append(date);

  // The tick also rewrites the date, so a tab left open past midnight shows the new day.
  const tick = () => {
    const now = new Date();
    clock?.update(now);
    if (enabled.date) date.textContent = date_text(now);
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const start = () => {
    tick();
    timer = setInterval(tick, 1000);
  };
  // A hidden tab stops ticking. The first tick after it shows again lands past the animation gap, so the hands jump to the time.
  document.addEventListener("visibilitychange", () => {
    clearInterval(timer);
    if (!document.hidden) start();
  });
  if (!document.hidden) start();
}
