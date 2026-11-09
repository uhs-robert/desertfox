import assert from "node:assert/strict";
import { test } from "node:test";
import { oasis_theme } from "../../src/shared/theme/load.ts";
import { OASIS_THEMES } from "../../src/shared/themes.ts";
import { LIGHT_INTENSITIES } from "../../src/shared/theme/roles.ts";
import type { RoleColors } from "../../src/shared/theme/roles.ts";

// WCAG relative luminance contrast ratio of two #rrggbb colors.
function contrast(first: string, second: string): number {
  const luminance = (color: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const channel = Number.parseInt(color.slice(at, at + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

// All 96 sets: 16 themes, each dark and five light.
const sets: [string, RoleColors][] = Object.keys(OASIS_THEMES).flatMap((name) => [
  [`${name} dark`, oasis_theme(name)!.dark] as [string, RoleColors],
  ...LIGHT_INTENSITIES.map((intensity) => [`${name} light ${intensity}`, oasis_theme(name)!.light[intensity]] as [string, RoleColors]),
]);

// fg_muted is for disabled text, so it has no floor.
test("fg_core is readable on bg_core, bg_mantle and selection in every set", () => {
  assert.equal(sets.length, 96);
  for (const [name, colors] of sets) {
    assert.ok(contrast(colors.fg_core, colors.bg_core) >= 4.5, `${name}: fg_core on bg_core`);
    assert.ok(contrast(colors.fg_core, colors.bg_mantle) >= 4.5, `${name}: fg_core on bg_mantle`);
    assert.ok(contrast(colors.fg_core, colors.selection) >= 4.5, `${name}: fg_core on selection`);
  }
});

// The worst fg_comment on bg_core is 3.98 (every light intensity), so 3.9 holds today's worst and catches a drop.
test("fg_comment stays at 3.9 or better on bg_core in every set", () => {
  for (const [name, colors] of sets) assert.ok(contrast(colors.fg_comment, colors.bg_core) >= 3.9, `${name}: ${contrast(colors.fg_comment, colors.bg_core).toFixed(2)}`);
});

// fg_dim colors the usage hint, on bg_core and the command line panel. tools/build_themes.ts raises it to 3:1 on both.
test("fg_dim is 3:1 or better on bg_core and bg_mantle in every set", () => {
  for (const [name, colors] of sets) {
    assert.ok(contrast(colors.fg_dim, colors.bg_core) >= 3, `${name}: bg_core ${contrast(colors.fg_dim, colors.bg_core).toFixed(2)}`);
    assert.ok(contrast(colors.fg_dim, colors.bg_mantle) >= 3, `${name}: bg_mantle ${contrast(colors.fg_dim, colors.bg_mantle).toFixed(2)}`);
  }
});
