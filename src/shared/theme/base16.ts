// Reads a base16 or base24 scheme (classic YAML or tinted-theming YAML) and maps its slots onto the 25 roles.
// No YAML library: a scheme is a flat list of `baseNN: "hex"` lines, and a parser for the whole language would add size and attack surface to read them.
// The slot-to-role table is the one place that decides which slot fills which role. A role with no slot derives in `derive.ts`.

import { clamped_fg_dim, FG_DIM_MIN_CONTRAST, luminance } from "./contrast.ts";
import { derive_roles } from "./derive.ts";
import type { GivenColors } from "./derive.ts";
import { DESKTOP_THEME } from "./roles.ts";
import type { Role, RoleColors, Theme, Variant } from "./roles.ts";
import { local_theme_problem } from "./theme_file.ts";
import { BUILT_IN_THEME_NAMES } from "../theme_names.ts";

// Slots are convention only, so the importer shows a preview before anything is saved. A role not listed here derives.
// `base24` marks the slots that only a base24 scheme has: a darker and a darkest background.
const SLOT_OF_ROLE: Partial<Record<Role, string>> = {
  bg_core: "base00",
  bg_mantle: "base01",
  selection: "base02",
  fg_core: "base05",
  fg_comment: "base03",
  fg_dim: "base04",
  primary: "base0d",
  secondary: "base0e",
  accent: "base0e",
  border: "base03",
  error: "base08",
  warn: "base09",
  ok: "base0b",
  info: "base0c",
  mode_normal: "base0d",
  mode_insert: "base0b",
  mode_ignore: "base04",
  mode_caret: "base0a",
  mode_visual: "base0e",
  search_bg: "base0a",
  search_fg: "base00",
  search_current_bg: "base09",
  search_current_fg: "base00",
};
const BASE24_SLOT_OF_ROLE: Partial<Record<Role, string>> = { bg_mantle: "base10", bg_crust: "base11" };

const BASE16_SLOTS = Array.from({ length: 16 }, (_, at) => `base${at.toString(16).padStart(2, "0")}`);
const BASE24_SLOTS = ["base10", "base11", "base12", "base13", "base14", "base15", "base16", "base17"];

export const MAX_SCHEME_CHARS = 64 * 1024;
const MAX_NAME_CHARS = 48;
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export type ImportedScheme = { name: string; author?: string; system: "base16" | "base24"; variant: Variant; variant_known: boolean; theme: Theme };
export type SchemeResult = { ok: true; scheme: ImportedScheme } | { ok: false; problem: string };

// How the spec spells a slot: base0A, not base0a.
const spelled = (slot: string): string => `base${slot.slice(4).toUpperCase()}`;

const refuse = (problem: string): SchemeResult => ({ ok: false, problem });

// The value after a colon: a quoted string, or the text up to a comment (a `#` after a space). A color with no quotes may start with `#`.
function scalar_of(rest: string): string {
  const text = rest.trim();
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1);
    return end < 0 ? text.slice(1) : text.slice(1, end);
  }
  return text.replace(/\s+#.*$/, "").trim();
}

// A name a user can type after `:set theme`: lowercase words, digits, `_` and `-`.
export function theme_name_shape_problem(name: string): string | undefined {
  if (name.length > MAX_NAME_CHARS) return `The name is longer than ${MAX_NAME_CHARS} characters.`;
  if (!NAME_PATTERN.test(name)) return "The name may hold lowercase letters, digits, _ and -, and starts with a letter or digit.";
  return undefined;
}

// A new import also refuses a built-in name, so it never shadows one.
export function theme_name_problem(name: string): string | undefined {
  const shape = theme_name_shape_problem(name);
  if (shape !== undefined) return shape;
  if (name === DESKTOP_THEME || BUILT_IN_THEME_NAMES.includes(name)) return `"${name}" is the name of a built-in theme. Pick another name.`;
  return undefined;
}

// The scheme's own name as a theme name. May still fail `theme_name_problem`, for example when a built-in has that name.
export function suggested_theme_name(scheme_name: string): string {
  const slug = scheme_name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, MAX_NAME_CHARS).replace(/_+$/, "");
  return slug === "" ? "imported" : slug;
}

export function parse_base16(text: string): SchemeResult {
  if (text.length > MAX_SCHEME_CHARS) return refuse(`The scheme is longer than ${MAX_SCHEME_CHARS / 1024} KB. A base16 scheme is a short file.`);
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const slots = new Map<string, string>();
  const fields: Record<string, string> = {};
  let content_seen = false;
  for (const [index, line] of lines.entries()) {
    const at = `line ${index + 1}`;
    if (/^---\s*$/.test(line)) {
      if (content_seen) return refuse(`${at}: the file holds more than one YAML document. Paste one scheme.`);
      continue;
    }
    if (/^\.\.\.\s*$/.test(line) || line.trim() === "" || /^\s*#/.test(line)) continue;
    content_seen = true;
    if (/^\s*\{/.test(line) || /^\s*palette\s*:\s*[{[]/.test(line)) return refuse(`${at}: flow style ({ ... }) is not supported. Write one baseNN: "rrggbb" line per color.`);
    const slot_line = /^\s*(base[0-9a-f]{2})\s*:(.*)$/i.exec(line);
    if (slot_line) {
      const slot = slot_line[1]!.toLowerCase();
      if (slots.has(slot)) return refuse(`${at}: ${spelled(slot)} appears twice.`);
      const hex = scalar_of(slot_line[2]!).replace(/^#/, "");
      if (!/^[0-9a-f]{6}$/i.test(hex)) return refuse(`${at}: ${spelled(slot)} is ${JSON.stringify(scalar_of(slot_line[2]!))}, not a six-digit hex color.`);
      slots.set(slot, `#${hex.toLowerCase()}`);
      continue;
    }
    // Only top-level fields, so a nested key never takes the scheme's name.
    const field = /^(name|scheme|author|variant|system)\s*:(.*)$/i.exec(line);
    if (field) fields[field[1]!.toLowerCase()] ??= scalar_of(field[2]!);
  }
  if (slots.size === 0) return refuse('No base16 color found. A scheme holds lines such as base00: "1e1e2e".');
  if (fields.system?.toLowerCase() === "tinted8") return refuse("The tinted8 format is not supported. Use a base16 or base24 scheme.");
  const missing = BASE16_SLOTS.filter((slot) => !slots.has(slot));
  if (missing.length > 0) return refuse(`The scheme lacks ${missing.map(spelled).join(", ")}. A base16 scheme needs base00 to base0F.`);

  const system = BASE24_SLOTS.some((slot) => slots.has(slot)) || fields.system?.toLowerCase() === "base24" ? "base24" : "base16";
  const variant_text = fields.variant?.toLowerCase();
  if (variant_text !== undefined && variant_text !== "dark" && variant_text !== "light") return refuse(`variant is ${JSON.stringify(fields.variant)}, not dark or light.`);
  const variant_known = variant_text !== undefined;
  const variant: Variant = variant_text ?? (luminance(slots.get("base00")!) > luminance(slots.get("base05")!) ? "light" : "dark");

  const given: Partial<RoleColors> = {};
  for (const [role, slot] of Object.entries(SLOT_OF_ROLE) as [Role, string][]) given[role] = slots.get(slot)!;
  if (system === "base24") {
    for (const [role, slot] of Object.entries(BASE24_SLOT_OF_ROLE) as [Role, string][]) if (slots.has(slot)) given[role] = slots.get(slot)!;
  }
  const colors = derive_roles(given as GivenColors, variant);
  const fg_dim = clamped_fg_dim(colors);
  if (fg_dim === undefined) return refuse(`base04 cannot reach a ${FG_DIM_MIN_CONTRAST}:1 contrast on base00 and base01, so the scheme has no readable dim text color.`);
  colors.fg_dim = fg_dim;
  colors.mode_ignore = fg_dim;

  // A scheme has one variant, so it serves both system settings.
  const theme: Theme = { dark: colors, light: { ...colors } };
  const problem = local_theme_problem(theme);
  if (problem !== undefined) return refuse(`The mapped theme is not usable: ${problem}`);
  const scheme_name = fields.name ?? fields.scheme ?? "";
  return { ok: true, scheme: { name: scheme_name, ...(fields.author && { author: fields.author }), system, variant, variant_known, theme } };
}
