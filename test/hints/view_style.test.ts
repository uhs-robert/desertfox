import assert from "node:assert/strict";
import { test } from "node:test";
import { STYLE } from "../../src/content/hints/view.ts";

const rule_of = (selector: string) => STYLE.match(new RegExp(`^${selector.replace(/\./g, "\\.")} \\{([^}]*)\\}`, "m"))![1]!;

test("hint labels take every color from the theme variables, as the which-key panel does", () => {
  const label = rule_of(".oasisfox-hint");
  assert.match(label, /background: var\(--oasisfox-bg, #0c0e13\)/);
  assert.match(label, /color: var\(--secondary\)/);
  assert.match(label, /border: 1px solid var\(--primary\)/);
  assert.match(rule_of(".oasisfox-hint b"), /var\(--oasisfox-fg, #f5f5dc\)/);
  assert.match(STYLE, /--primary: var\(--oasisfox-accent, #7fa3c9\)/);
  assert.match(STYLE, /--secondary: var\(--oasisfox-secondary, #f0e68c\)/);
});

test("a hint label rule holds no hard-coded color", () => {
  const label_rules = rule_of(".oasisfox-hint") + rule_of(".oasisfox-hint b");
  assert.doesNotMatch(label_rules.replace(/box-shadow:[^;]*;?/, "").replace(/var\([^)]*\)/g, ""), /#[0-9a-f]{3,8}\b/i);
});

test("the labels declare no theme variable, so a value set on the page or host reaches them", () => {
  assert.doesNotMatch(STYLE, /--oasisfox-[a-z]+\s*:/);
});
