// The DOM toolkit the help pages share. It imports no page, so the Settings pages can import it without a cycle through the page files.

import { copy_text } from "../shared/copy/copy_text.ts";
import type { Block, Inline } from "./blocks.ts";
import { key_caps } from "../shared/key_caps.ts";
import { PAGES } from "../shared/page/help_route.ts";
import type { PageId } from "../shared/page/help_route.ts";

export type Child = Node | string;

export function el(tag: string, class_name: string | undefined, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  if (class_name) node.className = class_name;
  node.append(...children);
  return node;
}

export function inline_node(inline: Inline): Child {
  switch (inline.kind) {
    case "text": return inline.text;
    case "code": return el("code", "desertfox-help-inline-code", inline.text);
    case "keys": return key_caps(inline.text);
    case "link": {
      const link = el("a", undefined, inline.text);
      link.setAttribute("href", inline.href);
      return link;
    }
  }
}

const COPIED_LABEL_MS = 1500;

// The pending "Copy" restore per button, so a second click restarts the 1.5 s instead of being cut short.
const pending_restore = new WeakMap<object, unknown>();

// A real button, so Tab and hints reach it. The label shows the result only after the clipboard took the text.
export async function copy_code_and_confirm(
  clipboard: Parameters<typeof copy_text>[0],
  text: string,
  button: { textContent: string | null },
  later: (restore: () => void, ms: number) => unknown = setTimeout,
  cancel: (handle: never) => void = clearTimeout,
): Promise<void> {
  if (!(await copy_text(clipboard, text))) return;
  button.textContent = "Copied";
  if (pending_restore.has(button)) cancel(pending_restore.get(button) as never);
  pending_restore.set(button, later(() => { button.textContent = "Copy"; }, COPIED_LABEL_MS));
}

export function code_block_node(text: string, language: string | undefined): HTMLElement {
  const button = el("button", "desertfox-help-code-copy", "Copy");
  button.setAttribute("type", "button");
  button.addEventListener("click", () => void copy_code_and_confirm(navigator.clipboard, text, button));
  const head = el("div", "desertfox-help-code-head", ...(language ? [el("span", "desertfox-help-code-lang", language)] : []), button);
  return el("div", "desertfox-help-code", head, el("pre", "desertfox-help-code-body", text));
}

const SHADOWED_CLASS = "desertfox-help-shadowed";
export const table_of = (class_name: string, heads: string[], rows: (HTMLElement | string)[][], shadowed: boolean[]): HTMLElement =>
  el("table", `desertfox-help-site-rules ${class_name}`, el("tr", undefined, ...heads.map((name) => el("th", undefined, name))), ...rows.map((cells, index) => el("tr", shadowed[index] ? SHADOWED_CLASS : undefined, ...cells.map((cell) => el("td", undefined, cell)))));

// An external link that opens in a new tab.
export function new_tab_link(title: string, url: string, class_name?: string): HTMLElement {
  const link = el("a", class_name, title);
  link.setAttribute("href", url);
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener noreferrer");
  return link;
}

export function block_node(block: Block): HTMLElement {
  switch (block.kind) {
    case "heading": return el(`h${block.level}`, undefined, block.text);
    case "paragraph": return el("p", undefined, ...block.inlines.map(inline_node));
    case "tip": return el("div", "desertfox-help-tip", el("strong", "desertfox-help-tip-label", "Tip"), ": ", ...block.inlines.map(inline_node));
    case "list": return el("ul", undefined, ...block.items.map((item) => el("li", undefined, ...item.map(inline_node))));
    case "code_block": return code_block_node(block.text, block.language);
  }
}

const page_hash = (id: PageId): string => PAGES.find((page) => page.id === id)!.hash;

export function page_link(text: string, id: PageId): HTMLElement {
  const link = el("a", undefined, text);
  link.setAttribute("href", page_hash(id));
  return link;
}
