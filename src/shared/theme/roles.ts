// The public role list. A theme file maps its colors onto these names and Oasis never sees the theme's own names.
// Contributed themes depend on every name here: adding a role is safe, renaming one breaks them.

export const ROLES = [
  "bg",
  "bg_mantle",
  "bg_crust",
  "selection",
  "fg",
  "muted",
  "primary",
  "secondary",
  "accent",
  "border",
  "error",
  "warn",
  "ok",
  "mode_normal",
  "mode_insert",
  "mode_ignore",
  "mode_caret",
  "mode_visual",
] as const;
export type Role = (typeof ROLES)[number];

// Every other role derives from these, see derive.ts.
export const REQUIRED_ROLES = ["bg", "fg", "primary", "accent"] as const satisfies readonly Role[];

export const VARIANTS = ["dark", "light"] as const;
export type Variant = (typeof VARIANTS)[number];

// Every role filled, colors as lowercase #rrggbb.
export type RoleColors = Record<Role, string>;
export type Theme = Record<Variant, RoleColors>;

export function is_role(name: string): name is Role {
  return (ROLES as readonly string[]).includes(name);
}
