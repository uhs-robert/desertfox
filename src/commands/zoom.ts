import type { CommandContext } from "../shared/command.ts";
import { define } from "../shared/registry/builtin.ts";
import { require_tab_id } from "./open_target.ts";

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 5;

export type ZoomDeps = {
  get_zoom: (tab_id: number) => Promise<number>;
  set_zoom: (tab_id: number, level: number) => Promise<void>;
};

// Rounded to 2 places so repeated 0.1 steps do not drift to 1.2000000000000002.
export function clamp_zoom(level: number): number {
  return Math.round(Math.min(Math.max(level, ZOOM_MIN), ZOOM_MAX) * 100) / 100;
}

export function make_zoom_handlers(deps: ZoomDeps) {
  return {
    by: async (ctx: CommandContext, args: { delta: number }) => {
      const tab_id = require_tab_id(ctx);
      await deps.set_zoom(tab_id, clamp_zoom((await deps.get_zoom(tab_id)) + args.delta));
    },
    set: (ctx: CommandContext, args: { level: number }) => deps.set_zoom(require_tab_id(ctx), clamp_zoom(args.level)),
  };
}

export const browser_zoom_deps: ZoomDeps = {
  get_zoom: (tab_id) => browser.tabs.getZoom(tab_id),
  set_zoom: (tab_id, level) => browser.tabs.setZoom(tab_id, level),
};

const handlers = make_zoom_handlers(browser_zoom_deps);

define("zoom.by", {
  label: "Zoom by",
  intent: "Zoom in or out by an amount. A value of 0.1 is ten percent. A count prefix repeats it.",
  params: [{ name: "delta", type: "float" }],
  runs_in: "background",
  count: "repeat",
  run: (ctx, args) => handlers.by(ctx, args as { delta: number }),
});

define("zoom.set", {
  name: "zoom",
  label: "Set zoom",
  intent: "Set the page zoom level. A level of 1 is 100%. The level is limited to 0.3 through 5.",
  params: [{ name: "level", type: "float" }],
  runs_in: "background",
  run: (ctx, args) => handlers.set(ctx, args as { level: number }),
});
