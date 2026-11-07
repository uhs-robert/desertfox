import assert from "node:assert/strict";
import test from "node:test";
import { deepest_focused_element } from "../../src/content/editable.ts";

const element = (props: object = {}) => props as Element;
const root_with_active = (active: Element | null) => ({ activeElement: active }) as unknown as ShadowRoot;

test("a host without a shadow root is its own deepest element", () => {
  const host = element();
  assert.equal(deepest_focused_element(host), host);
  assert.equal(deepest_focused_element(null), null);
});

test("an open root leads to the focused element inside", () => {
  const field = element();
  assert.equal(deepest_focused_element(element({ shadowRoot: root_with_active(field) })), field);
});

test("a closed root, which only openOrClosedShadowRoot reaches, leads to the focused element inside", () => {
  const field = element();
  assert.equal(deepest_focused_element(element({ openOrClosedShadowRoot: root_with_active(field) })), field);
});

test("nested open and closed roots are walked down to the innermost focus", () => {
  const field = element();
  const inner_host = element({ openOrClosedShadowRoot: root_with_active(field) });
  const outer_host = element({ shadowRoot: root_with_active(inner_host) });
  assert.equal(deepest_focused_element(outer_host), field);
});

test("a root with nothing focused stops at its host", () => {
  const host = element({ openOrClosedShadowRoot: root_with_active(null) });
  assert.equal(host === deepest_focused_element(host), true);
});
