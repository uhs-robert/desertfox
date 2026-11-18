import { CMDLINE_STYLE } from "../../src/cmdline/style.ts";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { STYLE as MODE_STYLE } from "../../src/content/mode_indicator.ts";
import { STYLE as TOAST_STYLE } from "../../src/content/toast.ts";
import { STYLE as HINTS_STYLE } from "../../src/content/hints/view.ts";
import { STYLE as WHICHKEY_STYLE } from "../../src/content/whichkey/style.ts";

// The outer var() is the user's `--desertfox-font`. Everything the font settings add sits in its fallback, so a user rule replaces the whole font.
const SURFACE_FONT = /font: var\(--desertfox-font, calc\(14px \* var\(--desertfox-font-scale, 1\)\) var\(--desertfox-font-family, system-ui, sans-serif\)\)/;

test("each in-page surface puts the font settings inside the fallback of --desertfox-font", () => {
  for (const [name, style] of Object.entries({ MODE_STYLE, TOAST_STYLE, HINTS_STYLE, WHICHKEY_STYLE })) assert.match(style, SURFACE_FONT, name);
});

test("the surfaces never declare a font variable", () => {
  for (const style of [MODE_STYLE, TOAST_STYLE, HINTS_STYLE, WHICHKEY_STYLE]) assert.doesNotMatch(style, /--desertfox-font[a-z-]*\s*:/);
});

test("the hint label takes the scale and the mono family", () => {
  assert.match(HINTS_STYLE, /font: bold calc\(12px \* var\(--desertfox-font-scale, 1\)\)\/1 var\(--desertfox-font-family-mono, ui-monospace, monospace\)/);
});

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the command line takes the mono family and scales its text and its row height with a floor", () => {
  const html = CMDLINE_STYLE;
  assert.match(html, /--desertfox-font: calc\(12px \* var\(--desertfox-font-scale, 1\)\)\/1\.4 var\(--desertfox-font-family-mono, ui-monospace, monospace\);/);
  assert.match(html, /height: max\(14px, calc\(20px \* var\(--desertfox-font-scale, 1\)\)\);/);
});

test("the popup takes the family and the scale", () => {
  assert.match(read("src/popup/popup.html"), /--desertfox-font: calc\(14px \* var\(--desertfox-font-scale, 1\)\)\/1\.4 var\(--desertfox-font-family, system-ui, sans-serif\);/);
});

test("the help page takes the family, its key caps the mono family, and its copy button the family", () => {
  const html = read("src/help/home.html");
  assert.match(html, /--desertfox-font: calc\(0\.9375rem \* var\(--desertfox-font-scale, 1\)\)\/1\.5 var\(--desertfox-font-family, system-ui, sans-serif\);/);
  assert.match(html, /html \{[^}]*font-size: 16px; \}/, "the scale must not touch the root");
  assert.doesNotMatch(html, /html \{[^}]*font-scale/);
  assert.match(html, /\.desertfox-help kbd \{ font-family: var\(--desertfox-font-family-mono, ui-monospace, monospace\); \}/);
  assert.match(html, /\.desertfox-help-code-copy \{[^}]*font: \.8em var\(--desertfox-font-family, system-ui, sans-serif\)/);
});

test("the shared page base takes the family and the mono family for key caps", () => {
  const css = read("src/shared/page_base.css");
  assert.match(css, /--desertfox-font: calc\(1rem \* var\(--desertfox-font-scale, 1\)\)\/1\.5 var\(--desertfox-font-family, system-ui, sans-serif\);/);
  assert.match(css, /html \{ font-size: 15px; \}/, "the scale must not touch the root");
  assert.match(css, /--desertfox-text-small: calc\(0\.85rem \* var\(--desertfox-font-scale, 1\)\);/);
  assert.match(css, /font: 0\.9em var\(--desertfox-font-family-mono, var\(--desertfox-mono\)\)/);
});

test("the new tab page scales its clock and gives its key cap the mono family", () => {
  const html = read("src/newtab/newtab.html");
  assert.match(html, /\.time \{[^}]*font-size: calc\(24px \* var\(--desertfox-font-scale, 1\)\)/);
  assert.match(html, /\.digits \{[^}]*font-size: min\(84px, 22vw\); \}/, "the digital clock is a graphic and stays one size");
  assert.match(html, /\.weather \{[^}]*font-size: calc\(1rem \* var\(--weather-scale\)\)/, "the whole weather card takes the capped scale");
  assert.match(html, /\.command-hint kbd \{[^}]*font-family: var\(--desertfox-font-family-mono, inherit\)/);
});

test("the grant panel and the in-page offsets follow the scale", async () => {
  assert.match(read("src/help/grant_panel.ts"), /font:var\(--desertfox-font,calc\(15px\*var\(--desertfox-font-scale,1\)\)\/1\.5 var\(--desertfox-font-family,system-ui,sans-serif\)\)/);
  for (const style of [TOAST_STYLE, WHICHKEY_STYLE, HINTS_STYLE]) assert.match(style, /bottom: calc\(4[48]px \* var\(--desertfox-font-scale, 1\)\)/);
});

test("the which-key rows scale their height, and the help sidebar scrolls instead of squeezing its links", () => {
  assert.match(WHICHKEY_STYLE, /\.row \{[^}]*height: calc\(22px \* var\(--desertfox-font-scale, 1\)\); line-height: calc\(22px \* var\(--desertfox-font-scale, 1\)\)/);
  assert.match(read("src/help/home.html"), /\.desertfox-help-sidebar > \* \{ flex-shrink: 0; \}/);
});

test("the new tab keeps its clock at one size and caps the weather block and scales the nav links", () => {
  const html = read("src/newtab/newtab.html");
  assert.match(html, /\.clock \{[^}]*max-width: calc\(10em \/ var\(--desertfox-font-scale, 1\)\)/);
  assert.match(html, /\.weather \{[^}]*--weather-scale: min\(var\(--desertfox-font-scale, 1\), 1\.5\)/);
  assert.match(html, /\.builtin-links \{[^}]*font-size: calc\(16px \* var\(--desertfox-font-scale, 1\)\)/);
});

test("the help brand wraps inside the sidebar", () => {
  assert.match(read("src/help/home.html"), /\.desertfox-help-brand \{ display: flex; flex-wrap: wrap; overflow-wrap: anywhere;/);
});
