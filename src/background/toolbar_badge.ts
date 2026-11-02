// The toolbar button's badge: three letters for the mode of the tab, colored like the page badge.

import type { Mode } from "../shared/command.ts";
import { DEFAULT_SETTINGS } from "../shared/config.ts";
import type { MergedConfig, ModeIndicator } from "../shared/index.ts";
import { palette_or_default, resolve_mode_colors } from "../shared/mode_colors.ts";
import type { ColorPair, ModeColorMode, ModeColors } from "../shared/mode_colors.ts";

export type ColorScheme = "dark" | "light";

export type ToolbarBadge = { text: string; title: string; color: ColorPair };

const BADGE_TEXTS: Record<ModeColorMode, { text: string; name: string }> = {
  normal: { text: "NOR", name: "NORMAL" },
  insert: { text: "INS", name: "INSERT" },
  ignore: { text: "IGN", name: "IGNORE" },
};

const is_badge_mode = (mode: Mode): mode is ModeColorMode => mode in BADGE_TEXTS;

// Undefined means no badge. Hint and command line modes draw their own surface, so they get none.
export function toolbar_badge(mode: Mode, setting: ModeIndicator, colors: ModeColors, scheme: ColorScheme): ToolbarBadge | undefined {
  if (setting === "off" || !is_badge_mode(mode)) return undefined;
  if (mode === "normal" && setting === "not_normal") return undefined;
  const { text, name } = BADGE_TEXTS[mode];
  return { text, title: `OasisFox: ${name} mode`, color: colors[mode][scheme] };
}

export function badge_for_config(mode: Mode, config: MergedConfig, scheme: ColorScheme): ToolbarBadge | undefined {
  const setting = config.settings.mode_indicator ?? DEFAULT_SETTINGS.mode_indicator;
  return toolbar_badge(mode, setting, resolve_mode_colors(palette_or_default(config.settings.palette)), scheme);
}

export type BadgeApi = Pick<typeof browser.browserAction, "setBadgeText" | "setBadgeBackgroundColor" | "setBadgeTextColor" | "setTitle">;

// A null title restores the manifest title.
export async function apply_toolbar_badge(api: BadgeApi, tab_id: number, badge: ToolbarBadge | undefined): Promise<void> {
  await Promise.all([
    api.setBadgeText({ tabId: tab_id, text: badge?.text ?? "" }),
    api.setTitle({ tabId: tab_id, title: badge?.title ?? null }),
    ...(badge === undefined
      ? []
      : [api.setBadgeBackgroundColor({ tabId: tab_id, color: badge.color[0] }), api.setBadgeTextColor({ tabId: tab_id, color: badge.color[1] })]),
  ]);
}

export type RefreshDeps = {
  api: BadgeApi;
  tab_ids: () => Promise<number[]>;
  reported_mode: (tab_id: number) => Promise<Mode | undefined>;
};

// Re-applies every tab from its stored mode. A tab that never reported has no content script and keeps no badge.
export async function refresh_toolbar_badges(deps: RefreshDeps, config: MergedConfig, scheme: ColorScheme): Promise<void> {
  await Promise.all(
    (await deps.tab_ids()).map(async (tab_id) => {
      const mode = await deps.reported_mode(tab_id);
      await apply_toolbar_badge(deps.api, tab_id, mode === undefined ? undefined : badge_for_config(mode, config, scheme));
    }),
  );
}
