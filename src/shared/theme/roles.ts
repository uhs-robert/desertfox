// The public role list. A theme file maps its colors onto these names and Oasis never sees the theme's own names.
// Contributed themes depend on every name here: adding a role is safe, renaming one breaks them.

export const ROLES = [
  "bg_core",
  "bg_mantle",
  "bg_crust",
  "selection",
  "fg_core",
  "fg_comment",
  "fg_dim",
  "fg_muted",
  "primary",
  "secondary",
  "accent",
  "border",
  "error",
  "warn",
  "ok",
  "info",
  "mode_normal",
  "mode_insert",
  "mode_ignore",
  "mode_caret",
  "mode_visual",
  "search_bg",
  "search_fg",
  "search_current_bg",
  "search_current_fg",
] as const;
export type Role = (typeof ROLES)[number];

// Every other role derives from these, see derive.ts.
export const REQUIRED_ROLES = ["bg_core", "fg_core", "primary", "accent"] as const satisfies readonly Role[];

export const VARIANTS = ["dark", "light"] as const;
export type Variant = (typeof VARIANTS)[number];

// Every role filled, colors as lowercase #rrggbb.
export type RoleColors = Record<Role, string>;
export type Theme = Record<Variant, RoleColors>;

// The theme a user's config directory holds under the theme's name, filled by tools/build-config.
export type LocalTheme = { name: string; colors: Theme };

// The `theme` value that follows the theme the desktop pushed over the bridge.
export const DESKTOP_THEME = "desktop";

// A built-in Oasis theme has one dark set and five light sets, one per light intensity. The `light_intensity` setting picks one.
export const LIGHT_INTENSITIES = [1, 2, 3, 4, 5] as const;
export type LightIntensity = (typeof LIGHT_INTENSITIES)[number];
export type OasisTheme = { dark: RoleColors; light: Record<LightIntensity, RoleColors> };
// The generated module stores each set as colors in ROLES order, and the reader zips them back with ROLES.
export type PackedOasisTheme = { dark: string[]; light: Record<LightIntensity, string[]> };

export function is_role(name: string): name is Role {
  return (ROLES as readonly string[]).includes(name);
}
