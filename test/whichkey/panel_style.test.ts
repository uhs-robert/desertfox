import assert from "node:assert/strict";
import { test } from "node:test";
import { STYLE as MODE_STYLE } from "../../src/content/mode_indicator.ts";
import { STYLE as TOAST_STYLE } from "../../src/content/toast.ts";
import { STYLE as PANEL_STYLE } from "../../src/content/whichkey/panel.ts";

const THEME_DECLARATION = /--oasisfox-(bg|fg|font|radius)\s*:/;

for (const [surface, style] of [["panel", PANEL_STYLE], ["toast", TOAST_STYLE], ["mode badge", MODE_STYLE]] as const) {
  test(`the ${surface} declares no theme variable, so a value set on the page or host reaches it`, () => {
    assert.doesNotMatch(style, THEME_DECLARATION);
    assert.match(style, /var\(--oasisfox-bg, #(222|0c0e13)\)/);
    assert.match(style, /var\(--oasisfox-radius, 6px\)|--bg: var/);
  });
}

test("the panel reads its colors through aliases that carry the fallbacks", () => {
  assert.match(PANEL_STYLE, /--bg: var\(--oasisfox-bg, #(222|0c0e13)\)/);
  assert.match(PANEL_STYLE, /--fg: var\(--oasisfox-fg, #(eee|f5f5dc)\)/);
  assert.doesNotMatch(PANEL_STYLE.replace(/--(bg|fg): var\([^)]*\)/g, ""), /var\(--oasisfox-(bg|fg)\)/);
});
