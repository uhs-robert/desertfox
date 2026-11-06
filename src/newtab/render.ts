// The built-in page: the clock (analog or digital) and the date.
import type { Settings } from "../shared/config.ts";
import { draw_clock } from "./clock.ts";
import { draw_digital_clock } from "./digital_clock.ts";

type WidgetSettings = Pick<Settings, "newtab_clock" | "newtab_date" | "newtab_clock_format">;

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

export function render_new_tab(body: HTMLElement, settings: WidgetSettings = {}): void {
  const page = document.createElement("main");
  page.className = "desertfox-newtab";
  body.prepend(page);

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
