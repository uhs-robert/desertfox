// The one table of what a missing role becomes. A derivation change is one edit here.

import { REQUIRED_ROLES, ROLES } from "./roles.ts";
import type { Role, RoleColors, Variant } from "./roles.ts";

type RequiredRole = (typeof REQUIRED_ROLES)[number];
export type GivenColors = Partial<RoleColors> & Pick<RoleColors, RequiredRole>;

const BLACK = "#000000";

// Mixes in sRGB, `amount` 0 gives `from` and 1 gives `to`. Both are #rrggbb.
export function mix(from: string, to: string, amount: number): string {
  const channel = (color: string, at: number) => Number.parseInt(color.slice(1 + at * 2, 3 + at * 2), 16);
  const mixed = [0, 1, 2].map((at) => Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * amount));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

// Status colors have no source role to lean on, so they are fixed per variant.
const per_variant = (dark: string, light: string) => (_colors: RoleColors, variant: Variant) => (variant === "dark" ? dark : light);

// In dependency order: a rule reads only required roles and roles above it.
const DERIVATIONS: [Exclude<Role, RequiredRole>, (colors: RoleColors, variant: Variant) => string][] = [
  ["bg_mantle", (colors) => mix(colors.bg, BLACK, 0.15)],
  ["bg_crust", (colors) => mix(colors.bg, BLACK, 0.3)],
  ["selection", (colors) => mix(colors.bg, colors.fg, 0.15)],
  ["muted", (colors) => mix(colors.fg, colors.bg, 0.45)],
  ["secondary", (colors) => colors.accent],
  ["border", (colors) => colors.muted],
  ["error", per_variant("#ffa0a0", "#8e0f14")],
  ["warn", per_variant("#ffba75", "#793f0d")],
  ["ok", per_variant("#7fcf78", "#315e2d")],
  ["mode_normal", (colors) => colors.primary],
  ["mode_insert", (colors) => colors.error],
  ["mode_ignore", (colors) => colors.muted],
  ["mode_caret", (colors) => colors.ok],
  ["mode_visual", (colors) => colors.warn],
];

export function derive_roles(given: GivenColors, variant: Variant): RoleColors {
  const colors = { ...given } as RoleColors;
  for (const [role, rule] of DERIVATIONS) colors[role] ??= rule(colors, variant);
  return Object.fromEntries(ROLES.map((role) => [role, colors[role]])) as RoleColors;
}
